import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { resolveRequestId } from '@lib/errors/app-error';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';
import { recordErrorEvent } from '@lib/server/errors/error-events';
import {
  buildPublicObjectUrl,
  deleteObject,
  headObject,
  isStoragePublicReadEnabled,
  listObjects,
  putObject,
} from '@lib/server/storage/minio-s3';
import {
  assertOwnedObjectPath,
  buildUserObjectPath,
  validateUploadInput,
} from '@lib/server/storage/object-policy';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

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

async function reportLegacyRelayUsage(input: {
  request: Request;
  identity: { userId: string; role: string | null };
  route: string;
}) {
  const requestId = resolveRequestId(input.request);
  await recordErrorEvent({
    code: 'STORAGE_LEGACY_RELAY_USED',
    source: 'storage',
    severity: 'warn',
    retryable: false,
    userMessage: 'Legacy relay upload path is active',
    developerMessage:
      'Storage content-images route accepted multipart relay upload while legacy relay switch is enabled.',
    requestId,
    actorUserId: input.identity.userId,
    httpStatus: 200,
    method: input.request.method,
    route: input.route,
    context: {
      upload_type: 'content-image',
      auth_role: input.identity.role || 'user',
    },
  });
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

async function handleCommitUpload(
  request: Request,
  identity: { userId: string; role: string | null }
) {
  const body = (await request.json()) as {
    path?: string;
    userId?: string;
  };

  const filePath = (body.path || '').trim();
  const targetUserId = (body.userId || '').trim();
  if (!filePath || !targetUserId) {
    return nextApiErrorResponse({
      request,
      status: 400,
      source: 'storage',
      code: 'STORAGE_CONTENT_IMAGE_COMMIT_PAYLOAD_INVALID',
      userMessage: 'Invalid commit request',
    });
  }

  if (
    !canManageTargetUser(identity.userId, identity.role || 'user', targetUserId)
  ) {
    return nextApiErrorResponse({
      request,
      status: 403,
      source: 'auth',
      code: 'AUTH_FORBIDDEN',
      userMessage: 'Forbidden',
    });
  }

  try {
    const payload = await attachContentImageObject(targetUserId, filePath);
    return NextResponse.json({
      success: true,
      path: payload.path,
      url: payload.url,
      readMode: payload.readMode,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('not found') ? 404 : 400;
    return nextApiErrorResponse({
      request,
      status,
      source: 'storage',
      code:
        status === 404
          ? 'STORAGE_CONTENT_IMAGE_OBJECT_NOT_FOUND'
          : 'STORAGE_CONTENT_IMAGE_COMMIT_FAILED',
      userMessage: message,
      developerMessage: message,
    });
  }
}

async function handleLegacyUpload(
  request: Request,
  identity: { userId: string; role: string | null }
) {
  const formData = await request.formData();
  const file = formData.get('file');
  const userId = String(formData.get('userId') || '').trim();
  if (!file || !(file instanceof File) || !userId) {
    return nextApiErrorResponse({
      request,
      status: 400,
      source: 'storage',
      code: 'STORAGE_CONTENT_IMAGE_UPLOAD_PAYLOAD_INVALID',
      userMessage: 'Invalid upload request',
    });
  }

  if (!canManageTargetUser(identity.userId, identity.role || 'user', userId)) {
    return nextApiErrorResponse({
      request,
      status: 403,
      source: 'auth',
      code: 'AUTH_FORBIDDEN',
      userMessage: 'Forbidden',
    });
  }

  const validation = validateUploadInput('content-images', {
    contentType: file.type,
    sizeBytes: file.size,
  });
  if (!validation.ok) {
    return nextApiErrorResponse({
      request,
      status: 400,
      source: 'storage',
      code: 'STORAGE_CONTENT_IMAGE_UPLOAD_INVALID',
      userMessage: validation.error,
    });
  }

  const filePath = buildUserObjectPath(
    'content-images',
    userId,
    file.name,
    file.type
  );
  const bytes = Buffer.from(await file.arrayBuffer());

  await putObject(
    'content-images',
    filePath,
    bytes,
    file.type || 'application/octet-stream'
  );

  try {
    const payload = await attachContentImageObject(userId, filePath);
    return NextResponse.json({
      success: true,
      path: payload.path,
      url: payload.url,
      readMode: payload.readMode,
    });
  } catch (error) {
    await deleteObject('content-images', filePath).catch(() => {
      // best-effort rollback
    });
    throw error;
  }
}

export async function GET(request: Request) {
  try {
    const auth = await resolveIdentity(request);
    if (!auth.ok) {
      return auth.response;
    }

    const url = new URL(request.url);
    const userId = (url.searchParams.get('userId') || '').trim();
    if (!userId) {
      return nextApiErrorResponse({
        request,
        status: 400,
        source: 'storage',
        code: 'STORAGE_USER_ID_MISSING',
        userMessage: 'Missing userId',
      });
    }

    if (
      !canManageTargetUser(
        auth.identity.userId,
        auth.identity.role || 'user',
        userId
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

    const files = await listObjects('content-images', `user-${userId}`);
    return NextResponse.json({
      success: true,
      files,
    });
  } catch (error) {
    console.error('[ContentImageStorageAPI] GET failed:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'storage',
      code: 'STORAGE_CONTENT_IMAGE_LIST_FAILED',
      userMessage: 'Failed to list content images',
      developerMessage:
        error instanceof Error
          ? error.message
          : 'Unknown content image list error',
    });
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveIdentity(request);
    if (!auth.ok) {
      return auth.response;
    }

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return handleCommitUpload(request, auth.identity);
    }

    if (!isLegacyRelayEnabled()) {
      return nextApiErrorResponse({
        request,
        status: 410,
        source: 'storage',
        code: 'STORAGE_LEGACY_RELAY_DISABLED',
        userMessage:
          'Legacy relay upload is disabled. Use the presign + commit upload flow.',
      });
    }

    console.warn('[ContentImageStorageAPI] Using legacy relay upload path');
    void reportLegacyRelayUsage({
      request,
      identity: auth.identity,
      route: '/api/internal/storage/content-images',
    }).catch(error => {
      console.warn(
        '[ContentImageStorageAPI] failed to record legacy relay usage event:',
        error instanceof Error ? error.message : String(error)
      );
    });

    return handleLegacyUpload(request, auth.identity);
  } catch (error) {
    console.error('[ContentImageStorageAPI] POST failed:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'storage',
      code: 'STORAGE_CONTENT_IMAGE_UPLOAD_FAILED',
      userMessage: 'Failed to upload content image',
      developerMessage:
        error instanceof Error
          ? error.message
          : 'Unknown content image upload error',
    });
  }
}

export async function DELETE(request: Request) {
  try {
    const auth = await resolveIdentity(request);
    if (!auth.ok) {
      return auth.response;
    }

    const body = (await request.json()) as {
      filePath?: string;
      userId?: string;
    };

    const filePath = (body.filePath || '').trim();
    const targetUserId = (body.userId || '').trim() || auth.identity.userId;
    if (!filePath) {
      return nextApiErrorResponse({
        request,
        status: 400,
        source: 'storage',
        code: 'STORAGE_OBJECT_PATH_MISSING',
        userMessage: 'Missing filePath',
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

    const ownership = assertOwnedObjectPath(filePath, targetUserId);
    if (!ownership.ok) {
      return nextApiErrorResponse({
        request,
        status: 400,
        source: 'storage',
        code: 'STORAGE_CONTENT_IMAGE_OBJECT_PATH_INVALID',
        userMessage: ownership.error,
      });
    }

    await deleteObject('content-images', filePath);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ContentImageStorageAPI] DELETE failed:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'storage',
      code: 'STORAGE_CONTENT_IMAGE_DELETE_FAILED',
      userMessage: 'Failed to delete content image',
      developerMessage:
        error instanceof Error
          ? error.message
          : 'Unknown content image delete error',
    });
  }
}
