import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { queryRowsWithPgUserContext } from '@lib/server/pg/user-context';
import {
  buildPublicObjectUrl,
  deleteObject,
  extractPathFromPublicUrl,
  headObject,
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
  const rows = await queryRowsWithPgUserContext<{ id: string }>(
    actorUserId,
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
    return NextResponse.json(
      { success: false, error: 'Invalid commit request' },
      { status: 400 }
    );
  }

  if (
    !canManageTargetUser(identity.userId, identity.role || 'user', targetUserId)
  ) {
    return NextResponse.json(
      { success: false, error: 'Forbidden' },
      { status: 403 }
    );
  }

  const ownership = assertOwnedObjectPath(filePath, targetUserId);
  if (!ownership.ok) {
    return NextResponse.json(
      { success: false, error: ownership.error },
      { status: 400 }
    );
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
    return NextResponse.json({ success: false, error: message }, { status });
  }
}

async function handleLegacyUpload(request: Request, identity: SessionIdentity) {
  const formData = await request.formData();
  const file = formData.get('file');
  const targetUserId = String(formData.get('userId') || '').trim();

  if (!file || !(file instanceof File) || !targetUserId) {
    return NextResponse.json(
      { success: false, error: 'Invalid upload request' },
      { status: 400 }
    );
  }

  if (
    !canManageTargetUser(identity.userId, identity.role || 'user', targetUserId)
  ) {
    return NextResponse.json(
      { success: false, error: 'Forbidden' },
      { status: 403 }
    );
  }

  const validation = validateUploadInput('avatars', {
    contentType: file.type,
    sizeBytes: file.size,
  });
  if (!validation.ok) {
    return NextResponse.json(
      { success: false, error: validation.error },
      { status: 400 }
    );
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

    return handleLegacyUpload(request, auth.identity);
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
    const targetUserId = (body.userId || '').trim() || auth.identity.userId;
    if (!filePath) {
      return NextResponse.json(
        { success: false, error: 'Invalid delete request' },
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

    const ownership = assertOwnedObjectPath(filePath, targetUserId);
    if (!ownership.ok) {
      return NextResponse.json(
        { success: false, error: ownership.error },
        { status: 400 }
      );
    }

    await deleteObject('avatars', filePath);

    await updateAvatarUrl(auth.identity.userId, targetUserId, null);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[AvatarStorageAPI] DELETE failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to delete avatar' },
      { status: 500 }
    );
  }
}
