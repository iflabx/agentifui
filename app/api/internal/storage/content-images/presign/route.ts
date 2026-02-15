import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import {
  buildPublicObjectUrl,
  createPresignedUploadUrl,
} from '@lib/server/storage/minio-s3';
import {
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

async function resolveIdentity(request: Request) {
  const result = await resolveSessionIdentity(request.headers);
  if (!result.success) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Failed to verify session' },
        { status: 500 }
      ),
    };
  }

  if (!result.data) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      ),
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
      return NextResponse.json(
        { success: false, error: 'Invalid presign payload' },
        { status: 400 }
      );
    }

    if (
      !canManageTargetUser(
        auth.identity.userId,
        auth.identity.role || 'user',
        targetUserId
      )
    ) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const validation = validateUploadInput('content-images', {
      contentType,
      sizeBytes: fileSize,
    });
    if (!validation.ok) {
      return NextResponse.json(
        { success: false, error: validation.error },
        { status: 400 }
      );
    }

    const path = buildUserObjectPath(
      'content-images',
      targetUserId,
      fileName,
      contentType
    );

    const uploadUrl = createPresignedUploadUrl('content-images', path, {
      expiresInSeconds: Number(body.expiresInSeconds || 300),
    });

    return NextResponse.json({
      success: true,
      path,
      uploadUrl,
      url: buildPublicObjectUrl('content-images', path),
    });
  } catch (error) {
    console.error('[ContentImageStoragePresignAPI] POST failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create content image upload URL' },
      { status: 500 }
    );
  }
}
