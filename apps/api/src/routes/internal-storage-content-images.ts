import type { FastifyPluginAsync } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { buildRouteErrorPayload } from '../lib/route-error';
import { requireStorageActor } from '../lib/storage/auth';
import {
  buildPublicObjectUrl,
  deleteObject,
  headObject,
  isStoragePublicReadEnabled,
  listObjects,
} from '../lib/storage/minio-s3';
import {
  assertOwnedObjectPath,
  validateUploadInput,
} from '../lib/storage/object-policy';

interface InternalStorageContentImagesRoutesOptions {
  config: ApiRuntimeConfig;
}

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

async function attachContentImageObject(
  targetUserId: string,
  filePath: string
) {
  const ownership = assertOwnedObjectPath(filePath, targetUserId);
  if (!ownership.ok) {
    throw new Error(ownership.error);
  }

  const head = await headObject('content-images', filePath);
  if (!head.exists) {
    throw new Error('Content image object not found');
  }

  const validation = validateUploadInput('content-images', {
    contentType: head.contentType || '',
    sizeBytes: head.contentLength || 0,
  });
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  return {
    path: filePath,
    url: buildPublicObjectUrl('content-images', filePath),
    readMode: isStoragePublicReadEnabled() ? 'public' : 'private',
  };
}

export const internalStorageContentImagesRoutes: FastifyPluginAsync<
  InternalStorageContentImagesRoutesOptions
> = async (app, options) => {
  app.get<{
    Querystring: {
      userId?: string;
    };
  }>('/api/internal/storage/content-images', async (request, reply) => {
    try {
      const auth = await requireStorageActor(request, options.config);
      if (!auth.ok) {
        return reply.status(auth.statusCode).send(auth.payload);
      }

      const userId = (request.query.userId || '').trim();
      if (!userId) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            source: 'storage',
            code: 'STORAGE_USER_ID_MISSING',
            userMessage: 'Missing userId',
          })
        );
      }

      if (!canManageTargetUser(auth.actor.userId, auth.actor.role, userId)) {
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

      const files = await listObjects('content-images', `user-${userId}`);
      return reply.send({
        success: true,
        files,
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][storage-content-images] GET failed'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          source: 'storage',
          code: 'STORAGE_CONTENT_IMAGE_LIST_FAILED',
          userMessage: 'Failed to list content images',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown content image list error',
        })
      );
    }
  });

  app.post<{
    Body: {
      path?: string;
      userId?: string;
    };
  }>('/api/internal/storage/content-images', async (request, reply) => {
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
            code: 'STORAGE_CONTENT_IMAGE_COMMIT_PAYLOAD_INVALID',
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

      try {
        const payload = await attachContentImageObject(targetUserId, filePath);
        return reply.send({
          success: true,
          path: payload.path,
          url: payload.url,
          readMode: payload.readMode,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = message.includes('not found') ? 404 : 400;
        return reply.status(status).send(
          buildRouteErrorPayload({
            request,
            statusCode: status,
            source: 'storage',
            code:
              status === 404
                ? 'STORAGE_CONTENT_IMAGE_OBJECT_NOT_FOUND'
                : 'STORAGE_CONTENT_IMAGE_COMMIT_FAILED',
            userMessage: message,
            developerMessage: message,
          })
        );
      }
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][storage-content-images] POST failed'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          source: 'storage',
          code: 'STORAGE_CONTENT_IMAGE_UPLOAD_FAILED',
          userMessage: 'Failed to upload content image',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown content image upload error',
        })
      );
    }
  });

  app.delete<{
    Body: {
      filePath?: string;
      userId?: string;
    };
  }>('/api/internal/storage/content-images', async (request, reply) => {
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
            code: 'STORAGE_CONTENT_IMAGE_OBJECT_PATH_INVALID',
            userMessage: ownership.error,
          })
        );
      }

      await deleteObject('content-images', filePath);
      return reply.send({ success: true });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][storage-content-images] DELETE failed'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          source: 'storage',
          code: 'STORAGE_CONTENT_IMAGE_DELETE_FAILED',
          userMessage: 'Failed to delete content image',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown content image delete error',
        })
      );
    }
  });
};
