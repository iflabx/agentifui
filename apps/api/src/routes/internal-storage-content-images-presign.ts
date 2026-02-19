import type { FastifyPluginAsync } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { buildRouteErrorPayload } from '../lib/route-error';
import { requireStorageActor } from '../lib/storage/auth';
import {
  buildPublicObjectUrl,
  createPresignedDownloadUrl,
  createPresignedUploadUrl,
  headObject,
  isStoragePublicReadEnabled,
} from '../lib/storage/minio-s3';
import {
  assertOwnedObjectPath,
  buildUserObjectPath,
  validateUploadInput,
} from '../lib/storage/object-policy';
import { enforceStoragePresignRateLimit } from '../lib/storage/rate-limit';

interface InternalStorageContentImagesPresignRoutesOptions {
  config: ApiRuntimeConfig;
}

function canManageTargetUser(
  currentUserId: string,
  currentRole: string,
  targetUserId: string
) {
  return currentUserId === targetUserId || currentRole === 'admin';
}

function parseExpiresInSeconds(raw: string | undefined): number | undefined {
  if (!raw) {
    return undefined;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export const internalStorageContentImagesPresignRoutes: FastifyPluginAsync<
  InternalStorageContentImagesPresignRoutesOptions
> = async (app, options) => {
  app.post<{
    Body: {
      userId?: string;
      fileName?: string;
      contentType?: string;
      fileSize?: number;
      expiresInSeconds?: number;
    };
  }>('/api/internal/storage/content-images/presign', async (request, reply) => {
    try {
      const auth = await requireStorageActor(request, options.config);
      if (!auth.ok) {
        return reply.status(auth.statusCode).send(auth.payload);
      }

      const rateLimit = await enforceStoragePresignRateLimit({
        actorUserId: auth.actor.userId,
        namespace: 'content-images',
        scope: 'upload',
      });
      if (rateLimit) {
        reply.header('Retry-After', String(rateLimit.retryAfterSeconds));
        return reply.status(429).send(
          buildRouteErrorPayload({
            request,
            statusCode: 429,
            source: 'storage',
            code: 'STORAGE_PRESIGN_RATE_LIMITED',
            userMessage:
              'Too many storage presign requests, please retry later',
          })
        );
      }

      const targetUserId = (request.body?.userId || '').trim();
      const fileName = (request.body?.fileName || '').trim();
      const contentType = (request.body?.contentType || '')
        .trim()
        .toLowerCase();
      const fileSize = Number(request.body?.fileSize || 0);

      if (
        !targetUserId ||
        !fileName ||
        !contentType ||
        !Number.isFinite(fileSize)
      ) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            source: 'storage',
            code: 'STORAGE_CONTENT_IMAGE_PRESIGN_PAYLOAD_INVALID',
            userMessage: 'Invalid presign payload',
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

      const validation = validateUploadInput('content-images', {
        contentType,
        sizeBytes: fileSize,
      });
      if (!validation.ok) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            source: 'storage',
            code: 'STORAGE_CONTENT_IMAGE_UPLOAD_INVALID',
            userMessage: validation.error,
          })
        );
      }

      const path = buildUserObjectPath(
        'content-images',
        targetUserId,
        fileName,
        contentType
      );
      const uploadUrl = createPresignedUploadUrl('content-images', path, {
        expiresInSeconds: Number(request.body?.expiresInSeconds || 300),
      });

      return reply.send({
        success: true,
        path,
        uploadUrl,
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][storage-content-images-presign] POST failed'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          source: 'storage',
          code: 'STORAGE_CONTENT_IMAGE_PRESIGN_UPLOAD_FAILED',
          userMessage: 'Failed to create content image upload URL',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown content image upload presign error',
        })
      );
    }
  });

  app.get<{
    Querystring: {
      path?: string;
      userId?: string;
      expiresInSeconds?: string;
    };
  }>('/api/internal/storage/content-images/presign', async (request, reply) => {
    try {
      const auth = await requireStorageActor(request, options.config);
      if (!auth.ok) {
        return reply.status(auth.statusCode).send(auth.payload);
      }

      const rateLimit = await enforceStoragePresignRateLimit({
        actorUserId: auth.actor.userId,
        namespace: 'content-images',
        scope: 'download',
      });
      if (rateLimit) {
        reply.header('Retry-After', String(rateLimit.retryAfterSeconds));
        return reply.status(429).send(
          buildRouteErrorPayload({
            request,
            statusCode: 429,
            source: 'storage',
            code: 'STORAGE_PRESIGN_RATE_LIMITED',
            userMessage:
              'Too many storage presign requests, please retry later',
          })
        );
      }

      const path = (request.query.path || '').trim();
      const requestedUserId = (request.query.userId || '').trim();
      const publicReadEnabled = isStoragePublicReadEnabled();

      if (!path) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            source: 'storage',
            code: 'STORAGE_OBJECT_PATH_MISSING',
            userMessage: 'Missing path',
          })
        );
      }

      if (path.includes('..')) {
        return reply.status(400).send(
          buildRouteErrorPayload({
            request,
            statusCode: 400,
            source: 'storage',
            code: 'STORAGE_OBJECT_PATH_INVALID',
            userMessage: 'Invalid path',
          })
        );
      }

      if (!publicReadEnabled) {
        const targetUserId = requestedUserId || auth.actor.userId;
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

        const ownership = assertOwnedObjectPath(path, targetUserId);
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
      }

      const head = await headObject('content-images', path);
      if (!head.exists) {
        return reply.status(404).send(
          buildRouteErrorPayload({
            request,
            statusCode: 404,
            source: 'storage',
            code: 'STORAGE_CONTENT_IMAGE_OBJECT_NOT_FOUND',
            userMessage: 'Content image object not found',
          })
        );
      }

      const downloadUrl = createPresignedDownloadUrl('content-images', path, {
        expiresInSeconds: parseExpiresInSeconds(request.query.expiresInSeconds),
      });

      return reply.send({
        success: true,
        path,
        downloadUrl,
        url: publicReadEnabled
          ? buildPublicObjectUrl('content-images', path)
          : null,
        readMode: publicReadEnabled ? 'public' : 'private',
        contentType: head.contentType,
        contentLength: head.contentLength,
      });
    } catch (error) {
      request.log.error(
        { err: error },
        '[FastifyAPI][storage-content-images-presign] GET failed'
      );
      return reply.status(500).send(
        buildRouteErrorPayload({
          request,
          statusCode: 500,
          source: 'storage',
          code: 'STORAGE_CONTENT_IMAGE_PRESIGN_DOWNLOAD_FAILED',
          userMessage: 'Failed to create content image download URL',
          developerMessage:
            error instanceof Error
              ? error.message
              : 'Unknown content image download presign error',
        })
      );
    }
  });
};
