import type { FastifyPluginAsync } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgUserContext } from '../lib/pg-context';
import { buildRouteErrorPayload } from '../lib/route-error';
import { requireStorageActor } from '../lib/storage/auth';
import {
  buildPublicObjectUrl,
  deleteObject,
  extractPathFromPublicUrl,
  headObject,
  isStoragePublicReadEnabled,
} from '../lib/storage/minio-s3';
import {
  assertOwnedObjectPath,
  validateUploadInput,
} from '../lib/storage/object-policy';

interface InternalStorageAvatarRoutesOptions {
  config: ApiRuntimeConfig;
}

type StorageActor = {
  userId: string;
  role: string;
};

function isLegacyRelayEnabled(): boolean {
  const normalized = (process.env.STORAGE_LEGACY_RELAY_ENABLED || '')
    .trim()
    .toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function canManageTargetUser(
  currentUserId: string,
  currentRole: string,
  targetUserId: string
) {
  return currentUserId === targetUserId || currentRole === 'admin';
}

async function loadCurrentAvatarUrl(
  actor: StorageActor,
  targetUserId: string
): Promise<string | null> {
  const rows = await queryRowsWithPgUserContext<{ avatar_url: string | null }>(
    actor.userId,
    actor.role,
    `
      SELECT avatar_url
      FROM profiles
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [targetUserId]
  );

  return rows[0]?.avatar_url || null;
}

async function updateAvatarUrl(
  actor: StorageActor,
  targetUserId: string,
  avatarUrl: string | null
): Promise<boolean> {
  const rows = await queryRowsWithPgUserContext<{ id: string }>(
    actor.userId,
    actor.role,
    `
      UPDATE profiles
      SET avatar_url = $2,
          updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING id::text
    `,
    [targetUserId, avatarUrl]
  );

  return Boolean(rows[0]);
}

async function attachAvatarObject(
  actor: StorageActor,
  targetUserId: string,
  filePath: string
): Promise<string> {
  const ownership = assertOwnedObjectPath(filePath, targetUserId);
  if (!ownership.ok) {
    throw new Error(ownership.error);
  }

  const head = await headObject('avatars', filePath);
  if (!head.exists) {
    throw new Error('Avatar object not found');
  }

  const validation = validateUploadInput('avatars', {
    contentType: head.contentType || '',
    sizeBytes: head.contentLength || 0,
  });
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const currentAvatarUrl = await loadCurrentAvatarUrl(actor, targetUserId);
  const publicUrl = buildPublicObjectUrl('avatars', filePath);
  const updated = await updateAvatarUrl(actor, targetUserId, publicUrl);
  if (!updated) {
    throw new Error('Profile not found');
  }

  if (currentAvatarUrl) {
    const oldPath = extractPathFromPublicUrl(currentAvatarUrl, 'avatars');
    if (oldPath && oldPath !== filePath) {
      deleteObject('avatars', oldPath).catch(error => {
        console.warn(
          '[FastifyStorageAvatar] failed to delete old avatar object:',
          error
        );
      });
    }
  }

  return publicUrl;
}

export const internalStorageAvatarRoutes: FastifyPluginAsync<
  InternalStorageAvatarRoutesOptions
> = async (app, options) => {
  app.post<{
    Body: {
      path?: string;
      userId?: string;
    };
  }>('/api/internal/storage/avatar', async (request, reply) => {
    try {
      const auth = await requireStorageActor(request, options.config);
      if (!auth.ok) {
        return reply.status(auth.statusCode).send(auth.payload);
      }

      const contentType = String(request.headers['content-type'] || '');
      if (!contentType.includes('application/json')) {
        if (!isLegacyRelayEnabled()) {
          return reply.status(410).send(
            buildRouteErrorPayload({
              request,
              statusCode: 410,
              source: 'storage',
              code: 'STORAGE_LEGACY_RELAY_DISABLED',
              userMessage:
                'Legacy relay upload is disabled. Use the presign + commit upload flow.',
            })
          );
        }

        return reply.status(501).send(
          buildRouteErrorPayload({
            request,
            statusCode: 501,
            source: 'storage',
            code: 'STORAGE_LEGACY_RELAY_NOT_IMPLEMENTED',
            userMessage:
              'Legacy relay upload is not supported by Fastify runtime.',
          })
        );
      }

      const filePath = (request.body?.path || '').trim();
      const targetUserId = (request.body?.userId || '').trim();
      if (!filePath || !targetUserId) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            source: 'storage',
            code: 'STORAGE_AVATAR_COMMIT_PAYLOAD_INVALID',
            userMessage: 'Invalid commit request',
          })
        );
      }

      if (
        !canManageTargetUser(auth.actor.userId, auth.actor.role, targetUserId)
      ) {
        return reply.status(403).send(
          buildRouteErrorPayload({
            request,
            statusCode: 403,
            source: 'auth',
            code: 'AUTH_FORBIDDEN',
            userMessage: 'Forbidden',
          })
        );
      }

      const ownership = assertOwnedObjectPath(filePath, targetUserId);
      if (!ownership.ok) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            source: 'storage',
            code: 'STORAGE_AVATAR_OBJECT_PATH_INVALID',
            userMessage: ownership.error,
          })
        );
      }

      try {
        const publicUrl = await attachAvatarObject(
          auth.actor,
          targetUserId,
          filePath
        );
        return reply.send({
          success: true,
          url: publicUrl,
          path: filePath,
          readMode: isStoragePublicReadEnabled() ? 'public' : 'private',
        });
      } catch (error) {
        await deleteObject('avatars', filePath).catch(cleanupError => {
          console.warn(
            '[FastifyStorageAvatar] failed to cleanup committed avatar object:',
            cleanupError
          );
        });

        const message = error instanceof Error ? error.message : String(error);
        const status = message.includes('not found') ? 404 : 400;
        return reply.status(status).send(
          buildRouteErrorPayload({
            request,
            statusCode: status,
            source: 'storage',
            code:
              status === 404
                ? 'STORAGE_AVATAR_OBJECT_NOT_FOUND'
                : 'STORAGE_AVATAR_COMMIT_FAILED',
            userMessage: message,
            developerMessage: message,
          })
        );
      }
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][storage-avatar] POST failed'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          source: 'storage',
          code: 'STORAGE_AVATAR_UPLOAD_FAILED',
          userMessage: 'Failed to upload avatar',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown avatar upload error',
        })
      );
    }
  });

  app.delete<{
    Body: {
      filePath?: string;
      userId?: string;
    };
  }>('/api/internal/storage/avatar', async (request, reply) => {
    try {
      const auth = await requireStorageActor(request, options.config);
      if (!auth.ok) {
        return reply.status(auth.statusCode).send(auth.payload);
      }

      const filePath = (request.body?.filePath || '').trim();
      const targetUserId =
        (request.body?.userId || '').trim() || auth.actor.userId;
      if (!filePath) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            source: 'storage',
            code: 'STORAGE_OBJECT_PATH_MISSING',
            userMessage: 'Missing filePath',
          })
        );
      }

      if (
        !canManageTargetUser(auth.actor.userId, auth.actor.role, targetUserId)
      ) {
        return reply.status(403).send(
          buildRouteErrorPayload({
            request,
            statusCode: 403,
            source: 'auth',
            code: 'AUTH_FORBIDDEN',
            userMessage: 'Forbidden',
          })
        );
      }

      const ownership = assertOwnedObjectPath(filePath, targetUserId);
      if (!ownership.ok) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            source: 'storage',
            code: 'STORAGE_AVATAR_OBJECT_PATH_INVALID',
            userMessage: ownership.error,
          })
        );
      }

      await deleteObject('avatars', filePath);
      await updateAvatarUrl(auth.actor, targetUserId, null);

      return reply.send({ success: true });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][storage-avatar] DELETE failed'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          source: 'storage',
          code: 'STORAGE_AVATAR_DELETE_FAILED',
          userMessage: 'Failed to delete avatar',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown avatar delete error',
        })
      );
    }
  });
};
