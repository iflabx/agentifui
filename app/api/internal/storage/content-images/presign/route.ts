import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import {
  buildPublicObjectUrl,
  createPresignedDownloadUrl,
  createPresignedUploadUrl,
  headObject,
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

  if (result.data.status !== 'active') {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Account is not active' },
        { status: 403 }
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

export async function GET(request: Request) {
  try {
    const auth = await resolveIdentity(request);
    if (!auth.ok) {
      return auth.response;
    }

    const url = new URL(request.url);
    const path = (url.searchParams.get('path') || '').trim();
    const targetUserId =
      (url.searchParams.get('userId') || '').trim() || auth.identity.userId;

    if (!path) {
      return NextResponse.json(
        { success: false, error: 'Missing path' },
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

    const ownership = assertOwnedObjectPath(path, targetUserId);
    if (!ownership.ok) {
      return NextResponse.json(
        { success: false, error: ownership.error },
        { status: 400 }
      );
    }

    const head = await headObject('content-images', path);
    if (!head.exists) {
      return NextResponse.json(
        { success: false, error: 'Content image object not found' },
        { status: 404 }
      );
    }

    const downloadUrl = createPresignedDownloadUrl('content-images', path, {
      expiresInSeconds: parseExpiresInSeconds(
        url.searchParams.get('expiresInSeconds')
      ),
    });

    return NextResponse.json({
      success: true,
      path,
      downloadUrl,
      url: buildPublicObjectUrl('content-images', path),
      contentType: head.contentType,
      contentLength: head.contentLength,
    });
  } catch (error) {
    console.error('[ContentImageStoragePresignAPI] GET failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to create content image download URL' },
      { status: 500 }
    );
  }
}
