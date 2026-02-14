import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import {
  addGroupMember,
  checkUserAppPermission,
  createGroup,
  deleteGroup,
  getGroupAppPermissions,
  getGroupMembers,
  getGroups,
  getUserAccessibleApps,
  incrementAppUsage,
  removeAllGroupAppPermissions,
  removeGroupAppPermission,
  removeGroupMember,
  searchUsersForGroup,
  setGroupAppPermission,
  updateGroup,
} from '@lib/db/group-permissions';
import {
  createSsoProvider,
  deleteSsoProvider,
  getSsoProviderById,
  getSsoProviderStats,
  getSsoProviders,
  toggleSsoProvider,
  updateSsoProvider,
  updateSsoProviderOrder,
} from '@lib/db/sso-providers';
import {
  batchUpdateUserRole,
  batchUpdateUserStatus,
  createUserProfile,
  deleteUser,
  getUserById,
  getUserList,
  getUserStats,
  updateUserProfile,
} from '@lib/db/users';
import { requireAdmin } from '@lib/services/admin/require-admin';
import type { Result } from '@lib/types/result';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

type InternalActionRequest = {
  action?: string;
  payload?: Record<string, unknown> | undefined;
};

const ADMIN_ACTIONS = new Set([
  'users.getUserList',
  'users.getUserStats',
  'users.getUserById',
  'users.updateUserProfile',
  'users.deleteUser',
  'users.createUserProfile',
  'users.batchUpdateUserStatus',
  'users.batchUpdateUserRole',
  'groups.getGroups',
  'groups.createGroup',
  'groups.updateGroup',
  'groups.deleteGroup',
  'groups.getGroupMembers',
  'groups.addGroupMember',
  'groups.removeGroupMember',
  'groups.getGroupAppPermissions',
  'groups.setGroupAppPermission',
  'groups.removeGroupAppPermission',
  'groups.removeAllGroupAppPermissions',
  'groups.searchUsersForGroup',
  'sso.getSsoProviders',
  'sso.getSsoProviderStats',
  'sso.getSsoProviderById',
  'sso.createSsoProvider',
  'sso.updateSsoProvider',
  'sso.deleteSsoProvider',
  'sso.toggleSsoProvider',
  'sso.updateSsoProviderOrder',
]);

const AUTH_ACTIONS = new Set([
  'groups.getUserAccessibleApps',
  'groups.checkUserAppPermission',
  'groups.incrementAppUsage',
]);

function toErrorResponse(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function toResultResponse<T>(result: Result<T>) {
  if (result.success) {
    return NextResponse.json({ success: true, data: result.data });
  }

  return NextResponse.json(
    { success: false, error: result.error?.message || 'Unknown error' },
    { status: 500 }
  );
}

function resolvePayloadUserId(payload: Record<string, unknown> | undefined) {
  if (!payload) return undefined;
  const direct = payload.userId;
  if (typeof direct === 'string' && direct) {
    return direct;
  }
  return undefined;
}

async function ensureActionPermission(
  request: Request,
  action: string,
  payload: Record<string, unknown> | undefined
): Promise<NextResponse | null> {
  if (ADMIN_ACTIONS.has(action)) {
    const adminResult = await requireAdmin(request.headers);
    if (!adminResult.ok) {
      return adminResult.response;
    }
    return null;
  }

  if (AUTH_ACTIONS.has(action)) {
    const identityResult = await resolveSessionIdentity(request.headers);
    if (!identityResult.success) {
      return toErrorResponse('Failed to verify session', 500);
    }
    if (!identityResult.data) {
      return toErrorResponse('Unauthorized', 401);
    }

    const payloadUserId = resolvePayloadUserId(payload);
    if (payloadUserId && payloadUserId !== identityResult.data.userId) {
      return toErrorResponse('Forbidden', 403);
    }
  }

  return null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InternalActionRequest;
    const action = body?.action?.trim();
    const payload = body?.payload;

    if (!action) {
      return toErrorResponse('Missing action', 400);
    }

    const permissionError = await ensureActionPermission(
      request,
      action,
      payload
    );
    if (permissionError) {
      return permissionError;
    }

    switch (action) {
      case 'users.getUserList':
        return toResultResponse(
          await getUserList((payload?.filters || {}) as any)
        );
      case 'users.getUserStats':
        return toResultResponse(await getUserStats());
      case 'users.getUserById':
        return toResultResponse(
          await getUserById(String(payload?.userId || ''))
        );
      case 'users.updateUserProfile':
        return toResultResponse(
          await updateUserProfile(
            String(payload?.userId || ''),
            (payload?.updates || {}) as any
          )
        );
      case 'users.deleteUser':
        return toResultResponse(
          await deleteUser(String(payload?.userId || ''))
        );
      case 'users.createUserProfile':
        return toResultResponse(
          await createUserProfile(
            String(payload?.userId || ''),
            (payload?.profileData || {}) as any
          )
        );
      case 'users.batchUpdateUserStatus':
        return toResultResponse(
          await batchUpdateUserStatus(
            (payload?.userIds || []) as string[],
            String(payload?.status || '') as any
          )
        );
      case 'users.batchUpdateUserRole':
        return toResultResponse(
          await batchUpdateUserRole(
            (payload?.userIds || []) as string[],
            String(payload?.role || '') as any
          )
        );
      case 'groups.getGroups':
        return toResultResponse(await getGroups());
      case 'groups.createGroup':
        return toResultResponse(
          await createGroup((payload?.data || {}) as any)
        );
      case 'groups.updateGroup':
        return toResultResponse(
          await updateGroup(
            String(payload?.groupId || ''),
            (payload?.data || {}) as any
          )
        );
      case 'groups.deleteGroup':
        return toResultResponse(
          await deleteGroup(String(payload?.groupId || ''))
        );
      case 'groups.getGroupMembers':
        return toResultResponse(
          await getGroupMembers(String(payload?.groupId || ''))
        );
      case 'groups.addGroupMember':
        return toResultResponse(
          await addGroupMember(
            String(payload?.groupId || ''),
            String(payload?.userId || '')
          )
        );
      case 'groups.removeGroupMember':
        return toResultResponse(
          await removeGroupMember(
            String(payload?.groupId || ''),
            String(payload?.userId || '')
          )
        );
      case 'groups.getGroupAppPermissions':
        return toResultResponse(
          await getGroupAppPermissions(String(payload?.groupId || ''))
        );
      case 'groups.setGroupAppPermission':
        return toResultResponse(
          await setGroupAppPermission(
            String(payload?.groupId || ''),
            String(payload?.serviceInstanceId || ''),
            (payload?.data || {}) as any
          )
        );
      case 'groups.removeGroupAppPermission':
        return toResultResponse(
          await removeGroupAppPermission(
            String(payload?.groupId || ''),
            String(payload?.serviceInstanceId || '')
          )
        );
      case 'groups.removeAllGroupAppPermissions':
        return toResultResponse(
          await removeAllGroupAppPermissions(
            String(payload?.serviceInstanceId || '')
          )
        );
      case 'groups.getUserAccessibleApps':
        return toResultResponse(
          await getUserAccessibleApps(String(payload?.userId || ''))
        );
      case 'groups.checkUserAppPermission':
        return toResultResponse(
          await checkUserAppPermission(
            String(payload?.userId || ''),
            String(payload?.serviceInstanceId || '')
          )
        );
      case 'groups.incrementAppUsage':
        return toResultResponse(
          await incrementAppUsage(
            String(payload?.userId || ''),
            String(payload?.serviceInstanceId || ''),
            Number(payload?.increment || 1)
          )
        );
      case 'groups.searchUsersForGroup':
        return toResultResponse(
          await searchUsersForGroup(
            String(payload?.searchTerm || ''),
            (payload?.excludeUserIds || []) as string[]
          )
        );
      case 'sso.getSsoProviders':
        return toResultResponse(
          await getSsoProviders((payload?.filters || {}) as any)
        );
      case 'sso.getSsoProviderStats':
        return toResultResponse(await getSsoProviderStats());
      case 'sso.getSsoProviderById':
        return toResultResponse(
          await getSsoProviderById(String(payload?.id || ''))
        );
      case 'sso.createSsoProvider':
        return toResultResponse(
          await createSsoProvider((payload?.data || {}) as any)
        );
      case 'sso.updateSsoProvider':
        return toResultResponse(
          await updateSsoProvider(
            String(payload?.id || ''),
            (payload?.data || {}) as any
          )
        );
      case 'sso.deleteSsoProvider':
        return toResultResponse(
          await deleteSsoProvider(String(payload?.id || ''))
        );
      case 'sso.toggleSsoProvider':
        return toResultResponse(
          await toggleSsoProvider(
            String(payload?.id || ''),
            Boolean(payload?.enabled)
          )
        );
      case 'sso.updateSsoProviderOrder':
        return toResultResponse(
          await updateSsoProviderOrder((payload?.updates || []) as any)
        );
      default:
        return toErrorResponse(`Unsupported action: ${action}`, 400);
    }
  } catch (error) {
    console.error('[InternalDataAPI] Unhandled error:', error);
    return toErrorResponse('Internal server error', 500);
  }
}
