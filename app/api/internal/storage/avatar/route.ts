import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { getPgPool } from '@lib/server/pg/pool';
import {
  buildPublicObjectUrl,
  deleteObject,
  extractPathFromPublicUrl,
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

    const pool = getPgPool();
    const currentProfile = await pool.query<{ avatar_url: string | null }>(
      `SELECT avatar_url FROM profiles WHERE id = $1::uuid LIMIT 1`,
      [userId]
    );
    const currentAvatarUrl = currentProfile.rows[0]?.avatar_url || null;

    const extension = resolveExtension(file.name, file.type);
    const filePath = `user-${userId}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const bytes = Buffer.from(await file.arrayBuffer());

    await putObject(
      'avatars',
      filePath,
      bytes,
      file.type || 'application/octet-stream'
    );
    const publicUrl = buildPublicObjectUrl('avatars', filePath);

    await pool.query(
      `
        UPDATE profiles
        SET avatar_url = $1,
            updated_at = NOW()
        WHERE id = $2::uuid
      `,
      [publicUrl, userId]
    );

    if (currentAvatarUrl) {
      const oldPath = extractPathFromPublicUrl(currentAvatarUrl, 'avatars');
      if (oldPath) {
        deleteObject('avatars', oldPath).catch(error => {
          console.warn(
            '[AvatarStorageAPI] Failed to delete old avatar object:',
            error
          );
        });
      }
    }

    return NextResponse.json({
      success: true,
      url: publicUrl,
      path: filePath,
    });
  } catch (error) {
    console.error('[AvatarStorageAPI] POST failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to upload avatar' },
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
    if (!filePath || !userId) {
      return NextResponse.json(
        { success: false, error: 'Invalid delete request' },
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

    await deleteObject('avatars', filePath);

    const pool = getPgPool();
    await pool.query(
      `
        UPDATE profiles
        SET avatar_url = NULL,
            updated_at = NOW()
        WHERE id = $1::uuid
      `,
      [userId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[AvatarStorageAPI] DELETE failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete avatar' },
      { status: 500 }
    );
  }
}
