import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';
import { enforceStoragePresignRateLimit } from '@lib/server/security/storage-rate-limit';
import {
  createPresignedDownloadUrl,
  createPresignedUploadUrl,
  headObject,
  isStoragePublicReadEnabled,
} from '@lib/server/storage/minio-s3';
import {
  assertOwnedObjectPath,
  buildUserObjectPath,
  validateUploadInput,
} from '@lib/server/storage/object-policy';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function canManageTargetUser(
  currentUserId: string,
  currentRole: string,
  targetUserId: string
) {
  return currentUserId === targetUserId || currentRole === 'admin';
}

function parseExpiresInSeconds(raw: string | null): number | undefined {
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

async function resolveIdentity(request: Request) {
  const result = await resolveSessionIdentity(request.headers);
  if (!result.success) {
    return {
      ok: false as const,
      response: nextApiErrorResponse({
        request,
        status: 500,
        source: 'auth',
        code: 'AUTH_VERIFY_FAILED',
        userMessage: 'Failed to verify session',
        developerMessage:
          result.error?.message ||
          'resolveSessionIdentity returned unsuccessful result',
      }),
    };
  }

  if (!result.data) {
    return {
      ok: false as const,
      response: nextApiErrorResponse({
        request,
        status: 401,
        source: 'auth',
        code: 'AUTH_UNAUTHORIZED',
        userMessage: 'Unauthorized',
      }),
    };
  }

  if (result.data.status !== 'active') {
    return {
      ok: false as const,
      response: nextApiErrorResponse({
        request,
        status: 403,
        source: 'auth',
        code: 'AUTH_ACCOUNT_INACTIVE',
        userMessage: 'Account is not active',
      }),
    };
  }

  return { ok: true as const, identity: result.data };
}

export async function POST(request: Request) {
  try {
    const auth = await resolveIdentity(request);
    if (!auth.ok) {
      return auth.response;
    }

    const rateLimitResponse = await enforceStoragePresignRateLimit({
      actorUserId: auth.identity.userId,
      namespace: 'avatars',
      scope: 'upload',
    });
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const body = (await request.json()) as {
      userId?: string;
      fileName?: string;
      contentType?: string;
      fileSize?: number;
      expiresInSeconds?: number;
    };

    const targetUserId = (body.userId || '').trim();
    const fileName = (body.fileName || '').trim();
    const contentType = (body.contentType || '').trim().toLowerCase();
    const fileSize = Number(body.fileSize || 0);

    if (
      !targetUserId ||
      !fileName ||
      !contentType ||
      !Number.isFinite(fileSize)
    ) {
      return nextApiErrorResponse({
        request,
        status: 400,
        source: 'storage',
        code: 'STORAGE_AVATAR_PRESIGN_PAYLOAD_INVALID',
        userMessage: 'Invalid presign payload',
      });
    }

    if (
      !canManageTargetUser(
        auth.identity.userId,
        auth.identity.role || 'user',
        targetUserId
      )
    ) {
      return nextApiErrorResponse({
        request,
        status: 403,
        source: 'auth',
        code: 'AUTH_FORBIDDEN',
        userMessage: 'Forbidden',
      });
    }

    const validation = validateUploadInput('avatars', {
      contentType,
      sizeBytes: fileSize,
    });
    if (!validation.ok) {
      return nextApiErrorResponse({
        request,
        status: 400,
        source: 'storage',
        code: 'STORAGE_AVATAR_UPLOAD_INVALID',
        userMessage: validation.error,
      });
    }

    const path = buildUserObjectPath(
      'avatars',
      targetUserId,
      fileName,
      contentType
    );
    const uploadUrl = createPresignedUploadUrl('avatars', path, {
      expiresInSeconds: Number(body.expiresInSeconds || 300),
    });

    return NextResponse.json({
      success: true,
      path,
      uploadUrl,
    });
  } catch (error) {
    console.error('[AvatarStoragePresignAPI] POST failed:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'storage',
      code: 'STORAGE_AVATAR_PRESIGN_UPLOAD_FAILED',
      userMessage: 'Failed to create avatar upload URL',
      developerMessage:
        error instanceof Error
          ? error.message
          : 'Unknown avatar upload presign error',
    });
  }
}

export async function GET(request: Request) {
  try {
    const auth = await resolveIdentity(request);
    if (!auth.ok) {
      return auth.response;
    }

    const rateLimitResponse = await enforceStoragePresignRateLimit({
      actorUserId: auth.identity.userId,
      namespace: 'avatars',
      scope: 'download',
    });
    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const url = new URL(request.url);
    const path = (url.searchParams.get('path') || '').trim();
    const requestedUserId = (url.searchParams.get('userId') || '').trim();
    const publicReadEnabled = isStoragePublicReadEnabled();

    if (!path) {
      return nextApiErrorResponse({
        request,
        status: 400,
        source: 'storage',
        code: 'STORAGE_OBJECT_PATH_MISSING',
        userMessage: 'Missing path',
      });
    }

    if (path.includes('..')) {
      return nextApiErrorResponse({
        request,
        status: 400,
        source: 'storage',
        code: 'STORAGE_OBJECT_PATH_INVALID',
        userMessage: 'Invalid path',
      });
    }

    if (!publicReadEnabled) {
      const targetUserId = requestedUserId || auth.identity.userId;
      if (
        !canManageTargetUser(
          auth.identity.userId,
          auth.identity.role || 'user',
          targetUserId
        )
      ) {
        return nextApiErrorResponse({
          request,
          status: 403,
          source: 'auth',
          code: 'AUTH_FORBIDDEN',
          userMessage: 'Forbidden',
        });
      }

      const ownership = assertOwnedObjectPath(path, targetUserId);
      if (!ownership.ok) {
        return nextApiErrorResponse({
          request,
          status: 400,
          source: 'storage',
          code: 'STORAGE_AVATAR_OBJECT_PATH_INVALID',
          userMessage: ownership.error,
        });
      }
    }

    const head = await headObject('avatars', path);
    if (!head.exists) {
      return nextApiErrorResponse({
        request,
        status: 404,
        source: 'storage',
        code: 'STORAGE_AVATAR_OBJECT_NOT_FOUND',
        userMessage: 'Avatar object not found',
      });
    }

    const downloadUrl = createPresignedDownloadUrl('avatars', path, {
      expiresInSeconds: parseExpiresInSeconds(
        url.searchParams.get('expiresInSeconds')
      ),
    });

    return NextResponse.json({
      success: true,
      path,
      downloadUrl,
      readMode: publicReadEnabled ? 'public' : 'private',
      contentType: head.contentType,
      contentLength: head.contentLength,
    });
  } catch (error) {
    console.error('[AvatarStoragePresignAPI] GET failed:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'storage',
      code: 'STORAGE_AVATAR_PRESIGN_DOWNLOAD_FAILED',
      userMessage: 'Failed to create avatar download URL',
      developerMessage:
        error instanceof Error
          ? error.message
          : 'Unknown avatar download presign error',
    });
  }
}
