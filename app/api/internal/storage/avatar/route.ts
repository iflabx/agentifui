import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { resolveRequestId } from '@lib/errors/app-error';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';
import { recordErrorEvent } from '@lib/server/errors/error-events';
import { queryRowsWithPgUserContext } from '@lib/server/pg/user-context';
import { publishTableChangeEvent } from '@lib/server/realtime/publisher';
import {
  buildPublicObjectUrl,
  deleteObject,
  extractPathFromPublicUrl,
  headObject,
  isStoragePublicReadEnabled,
  putObject,
} from '@lib/server/storage/minio-s3';
import {
  assertOwnedObjectPath,
  buildUserObjectPath,
  validateUploadInput,
} from '@lib/server/storage/object-policy';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type SessionIdentity = {
  userId: string;
  role: string | null;
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
  identity: SessionIdentity;
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
      'Storage avatar route accepted multipart relay upload while legacy relay switch is enabled.',
    requestId,
    actorUserId: input.identity.userId,
    httpStatus: 200,
    method: input.request.method,
    route: input.route,
    context: {
      upload_type: 'avatar',
      auth_role: input.identity.role || 'user',
    },
  });
}

async function loadCurrentAvatarUrl(
  actorUserId: string,
  targetUserId: string
): Promise<string | null> {
  const rows = await queryRowsWithPgUserContext<{ avatar_url: string | null }>(
    actorUserId,
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
  actorUserId: string,
  targetUserId: string,
  avatarUrl: string | null
): Promise<boolean> {
  const oldRows = await queryRowsWithPgUserContext<{
    id: string;
    avatar_url: string | null;
  }>(
    actorUserId,
    `
      SELECT id::text, avatar_url
      FROM profiles
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [targetUserId]
  );
  const oldRow = oldRows[0] || null;

  const rows = await queryRowsWithPgUserContext<{
    id: string;
    avatar_url: string | null;
  }>(
    actorUserId,
    `
      UPDATE profiles
      SET avatar_url = $2,
          updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING id::text, avatar_url
    `,
    [targetUserId, avatarUrl]
  );

  if (!rows[0]) {
    return false;
  }

  await publishTableChangeEvent({
    table: 'profiles',
    eventType: 'UPDATE',
    oldRow,
    newRow: rows[0],
  }).catch(error => {
    console.warn('[AvatarStorageAPI] Realtime publish failed:', error);
  });

  return true;
}

async function attachAvatarObject(
  identity: SessionIdentity,
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

  const currentAvatarUrl = await loadCurrentAvatarUrl(
    identity.userId,
    targetUserId
  );
  const publicUrl = buildPublicObjectUrl('avatars', filePath);

  const updated = await updateAvatarUrl(
    identity.userId,
    targetUserId,
    publicUrl
  );
  if (!updated) {
    throw new Error('Profile not found');
  }

  if (currentAvatarUrl) {
    const oldPath = extractPathFromPublicUrl(currentAvatarUrl, 'avatars');
    if (oldPath && oldPath !== filePath) {
      deleteObject('avatars', oldPath).catch(error => {
        console.warn(
          '[AvatarStorageAPI] Failed to delete old avatar object:',
          error
        );
      });
    }
  }

  return publicUrl;
}

async function handleCommitUpload(request: Request, identity: SessionIdentity) {
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
      code: 'STORAGE_AVATAR_COMMIT_PAYLOAD_INVALID',
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

  const ownership = assertOwnedObjectPath(filePath, targetUserId);
  if (!ownership.ok) {
    return nextApiErrorResponse({
      request,
      status: 400,
      source: 'storage',
      code: 'STORAGE_AVATAR_OBJECT_PATH_INVALID',
      userMessage: ownership.error,
    });
  }

  try {
    const publicUrl = await attachAvatarObject(
      identity,
      targetUserId,
      filePath
    );
    return NextResponse.json({
      success: true,
      url: publicUrl,
      path: filePath,
      readMode: isStoragePublicReadEnabled() ? 'public' : 'private',
    });
  } catch (error) {
    await deleteObject('avatars', filePath).catch(cleanupError => {
      console.warn(
        '[AvatarStorageAPI] Failed to cleanup committed avatar object:',
        cleanupError
      );
    });

    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('not found') ? 404 : 400;
    return nextApiErrorResponse({
      request,
      status,
      source: 'storage',
      code:
        status === 404
          ? 'STORAGE_AVATAR_OBJECT_NOT_FOUND'
          : 'STORAGE_AVATAR_COMMIT_FAILED',
      userMessage: message,
      developerMessage: message,
    });
  }
}

async function handleLegacyUpload(request: Request, identity: SessionIdentity) {
  const formData = await request.formData();
  const file = formData.get('file');
  const targetUserId = String(formData.get('userId') || '').trim();

  if (!file || !(file instanceof File) || !targetUserId) {
    return nextApiErrorResponse({
      request,
      status: 400,
      source: 'storage',
      code: 'STORAGE_AVATAR_UPLOAD_PAYLOAD_INVALID',
      userMessage: 'Invalid upload request',
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

  const validation = validateUploadInput('avatars', {
    contentType: file.type,
    sizeBytes: file.size,
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

  const filePath = buildUserObjectPath(
    'avatars',
    targetUserId,
    file.name,
    file.type
  );
  const bytes = Buffer.from(await file.arrayBuffer());

  await putObject(
    'avatars',
    filePath,
    bytes,
    file.type || 'application/octet-stream'
  );

  try {
    const publicUrl = await attachAvatarObject(
      identity,
      targetUserId,
      filePath
    );
    return NextResponse.json({
      success: true,
      url: publicUrl,
      path: filePath,
      readMode: isStoragePublicReadEnabled() ? 'public' : 'private',
    });
  } catch (error) {
    await deleteObject('avatars', filePath).catch(() => {
      // best-effort rollback
    });
    throw error;
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

    console.warn('[AvatarStorageAPI] Using legacy relay upload path');
    void reportLegacyRelayUsage({
      request,
      identity: auth.identity,
      route: '/api/internal/storage/avatar',
    }).catch(error => {
      console.warn(
        '[AvatarStorageAPI] failed to record legacy relay usage event:',
        error instanceof Error ? error.message : String(error)
      );
    });

    return handleLegacyUpload(request, auth.identity);
  } catch (error) {
    console.error('[AvatarStorageAPI] POST failed:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'storage',
      code: 'STORAGE_AVATAR_UPLOAD_FAILED',
      userMessage: 'Failed to upload avatar',
      developerMessage:
        error instanceof Error ? error.message : 'Unknown avatar upload error',
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
        code: 'STORAGE_AVATAR_DELETE_PAYLOAD_INVALID',
        userMessage: 'Invalid delete request',
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
        code: 'STORAGE_AVATAR_OBJECT_PATH_INVALID',
        userMessage: ownership.error,
      });
    }

    await deleteObject('avatars', filePath);

    await updateAvatarUrl(auth.identity.userId, targetUserId, null);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[AvatarStorageAPI] DELETE failed:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      source: 'storage',
      code: 'STORAGE_AVATAR_DELETE_FAILED',
      userMessage: 'Failed to delete avatar',
      developerMessage:
        error instanceof Error ? error.message : 'Unknown avatar delete error',
    });
  }
}
