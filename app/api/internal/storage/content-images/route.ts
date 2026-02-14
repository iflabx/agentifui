import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import {
  buildPublicObjectUrl,
  deleteObject,
  listObjects,
  putObject,
} from '@lib/server/storage/minio-s3';
import crypto from 'node:crypto';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function resolveExtension(fileName: string, mimeType: string) {
  const extFromName = fileName.split('.').pop()?.trim().toLowerCase();
  if (extFromName) {
    return extFromName;
  }

  if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') return 'jpg';
  if (mimeType === 'image/png') return 'png';
  if (mimeType === 'image/webp') return 'webp';
  if (mimeType === 'image/gif') return 'gif';
  return 'bin';
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

function canManageTargetUser(
  currentUserId: string,
  currentRole: string,
  targetUserId: string
) {
  return currentUserId === targetUserId || currentRole === 'admin';
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
      return NextResponse.json(
        { success: false, error: 'Missing userId' },
        { status: 400 }
      );
    }

    if (
      !canManageTargetUser(
        auth.identity.userId,
        auth.identity.role || 'user',
        userId
      )
    ) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const files = await listObjects('content-images', `user-${userId}`);
    return NextResponse.json({
      success: true,
      files,
    });
  } catch (error) {
    console.error('[ContentImageStorageAPI] GET failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to list content images' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const auth = await resolveIdentity(request);
    if (!auth.ok) {
      return auth.response;
    }

    const formData = await request.formData();
    const file = formData.get('file');
    const userId = String(formData.get('userId') || '').trim();
    if (!file || !(file instanceof File) || !userId) {
      return NextResponse.json(
        { success: false, error: 'Invalid upload request' },
        { status: 400 }
      );
    }

    if (
      !canManageTargetUser(
        auth.identity.userId,
        auth.identity.role || 'user',
        userId
      )
    ) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const extension = resolveExtension(file.name, file.type);
    const filePath = `user-${userId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    await putObject(
      'content-images',
      filePath,
      bytes,
      file.type || 'application/octet-stream'
    );

    return NextResponse.json({
      success: true,
      path: filePath,
      url: buildPublicObjectUrl('content-images', filePath),
    });
  } catch (error) {
    console.error('[ContentImageStorageAPI] POST failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to upload content image' },
      { status: 500 }
    );
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
    const userId = (body.userId || '').trim();
    if (!filePath) {
      return NextResponse.json(
        { success: false, error: 'Missing filePath' },
        { status: 400 }
      );
    }

    const targetUserId = userId || auth.identity.userId;
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

    if (
      (auth.identity.role || 'user') !== 'admin' &&
      !filePath.startsWith(`user-${auth.identity.userId}/`)
    ) {
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    await deleteObject('content-images', filePath);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[ContentImageStorageAPI] DELETE failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete content image' },
      { status: 500 }
    );
  }
}
