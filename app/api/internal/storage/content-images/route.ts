import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
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
    return NextResponse.json({ success: false, error: message }, { status });
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
    return NextResponse.json(
      { success: false, error: 'Invalid upload request' },
      { status: 400 }
    );
  }

  if (!canManageTargetUser(identity.userId, identity.role || 'user', userId)) {
    return NextResponse.json(
      { success: false, error: 'Forbidden' },
      { status: 403 }
    );
  }

  const validation = validateUploadInput('content-images', {
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

    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      return handleCommitUpload(request, auth.identity);
    }

    return handleLegacyUpload(request, auth.identity);
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
    const targetUserId = (body.userId || '').trim() || auth.identity.userId;
    if (!filePath) {
      return NextResponse.json(
        { success: false, error: 'Missing filePath' },
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
