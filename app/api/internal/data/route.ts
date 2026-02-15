import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import {
  deleteConversationForUser,
  getUserConversations,
  renameConversationForUser,
} from '@lib/db/conversations';
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
  'conversations.getUserConversations',
  'conversations.renameConversation',
  'conversations.deleteConversation',
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

function requireString(
  payload: Record<string, unknown> | undefined,
  key: string
) {
  const value = payload?.[key];
  if (typeof value === 'string') {
    return value.trim();
  }
  return '';
}

function parsePositiveInt(input: unknown, fallback: number) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.floor(parsed));
}

async function ensureActionPermission(
  request: Request,
  action: string,
  payload: Record<string, unknown> | undefined
): Promise<{ error: NextResponse | null; actorUserId?: string }> {
  if (ADMIN_ACTIONS.has(action)) {
    const adminResult = await requireAdmin(request.headers);
    if (!adminResult.ok) {
      return { error: adminResult.response };
    }
    return { error: null, actorUserId: adminResult.userId };
  }

  if (AUTH_ACTIONS.has(action)) {
    const identityResult = await resolveSessionIdentity(request.headers);
    if (!identityResult.success) {
      return { error: toErrorResponse('Failed to verify session', 500) };
    }
    if (!identityResult.data) {
      return { error: toErrorResponse('Unauthorized', 401) };
    }

    const payloadUserId = resolvePayloadUserId(payload);
    if (payloadUserId && payloadUserId !== identityResult.data.userId) {
      return { error: toErrorResponse('Forbidden', 403) };
    }

    return { error: null, actorUserId: identityResult.data.userId };
  }

  return { error: null };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as InternalActionRequest;
    const action = body?.action?.trim();
    const payload = body?.payload;

    if (!action) {
      return toErrorResponse('Missing action', 400);
    }

    const permission = await ensureActionPermission(request, action, payload);
    if (permission.error) {
      return permission.error;
    }
    const actorUserId = permission.actorUserId;

    switch (action) {
      case 'users.getUserList':
        return toResultResponse(
          await getUserList(
            payload?.filters as Parameters<typeof getUserList>[0]
          )
        );
      case 'users.getUserStats':
        return toResultResponse(await getUserStats(actorUserId));
      case 'users.getUserById':
        return toResultResponse(
          await getUserById(String(payload?.userId || ''), actorUserId)
        );
      case 'users.updateUserProfile':
        return toResultResponse(
          await updateUserProfile(
            String(payload?.userId || ''),
            (payload?.updates || {}) as Parameters<typeof updateUserProfile>[1]
          )
        );
      case 'users.deleteUser':
        return toResultResponse(
          await deleteUser(String(payload?.userId || ''), actorUserId)
        );
      case 'users.createUserProfile':
        return toResultResponse(
          await createUserProfile(
            String(payload?.userId || ''),
            (payload?.profileData || {}) as Parameters<
              typeof createUserProfile
            >[1]
          )
        );
      case 'users.batchUpdateUserStatus':
        return toResultResponse(
          await batchUpdateUserStatus(
            (payload?.userIds || []) as string[],
            String(payload?.status || '') as Parameters<
              typeof batchUpdateUserStatus
            >[1]
          )
        );
      case 'users.batchUpdateUserRole':
        return toResultResponse(
          await batchUpdateUserRole(
            (payload?.userIds || []) as string[],
            String(payload?.role || '') as Parameters<
              typeof batchUpdateUserRole
            >[1]
          )
        );
      case 'groups.getGroups':
        return toResultResponse(await getGroups());
      case 'groups.createGroup':
        return toResultResponse(
          await createGroup(
            (payload?.data || {}) as Parameters<typeof createGroup>[0]
          )
        );
      case 'groups.updateGroup':
        return toResultResponse(
          await updateGroup(
            String(payload?.groupId || ''),
            (payload?.data || {}) as Parameters<typeof updateGroup>[1]
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
            (payload?.data || {}) as Parameters<typeof setGroupAppPermission>[2]
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
          await getUserAccessibleApps(
            String(payload?.userId || ''),
            actorUserId
          )
        );
      case 'groups.checkUserAppPermission':
        return toResultResponse(
          await checkUserAppPermission(
            String(payload?.userId || ''),
            String(payload?.serviceInstanceId || ''),
            actorUserId
          )
        );
      case 'groups.incrementAppUsage':
        return toResultResponse(
          await incrementAppUsage(
            String(payload?.userId || ''),
            String(payload?.serviceInstanceId || ''),
            Number(payload?.increment || 1),
            actorUserId
          )
        );
      case 'groups.searchUsersForGroup':
        return toResultResponse(
          await searchUsersForGroup(
            String(payload?.searchTerm || ''),
            (payload?.excludeUserIds || []) as string[]
          )
        );
      case 'conversations.getUserConversations': {
        const userId = requireString(payload, 'userId');
        if (!userId) {
          return toErrorResponse('Missing userId', 400);
        }

        const limit = Math.min(parsePositiveInt(payload?.limit, 20), 1000);
        const offset = parsePositiveInt(payload?.offset, 0);
        const appIdRaw = requireString(payload, 'appId');
        const appId = appIdRaw || undefined;

        return toResultResponse(
          await getUserConversations(userId, limit, offset, appId)
        );
      }
      case 'conversations.renameConversation': {
        const userId = requireString(payload, 'userId');
        const conversationId = requireString(payload, 'conversationId');
        const title = requireString(payload, 'title');
        if (!userId || !conversationId || !title) {
          return toErrorResponse('Missing required fields', 400);
        }

        return toResultResponse(
          await renameConversationForUser(userId, conversationId, title)
        );
      }
      case 'conversations.deleteConversation': {
        const userId = requireString(payload, 'userId');
        const conversationId = requireString(payload, 'conversationId');
        if (!userId || !conversationId) {
          return toErrorResponse('Missing required fields', 400);
        }

        return toResultResponse(
          await deleteConversationForUser(userId, conversationId)
        );
      }
      case 'sso.getSsoProviders':
        return toResultResponse(
          await getSsoProviders(
            (payload?.filters || {}) as Parameters<typeof getSsoProviders>[0]
          )
        );
      case 'sso.getSsoProviderStats':
        return toResultResponse(await getSsoProviderStats());
      case 'sso.getSsoProviderById':
        return toResultResponse(
          await getSsoProviderById(String(payload?.id || ''))
        );
      case 'sso.createSsoProvider':
        return toResultResponse(
          await createSsoProvider(
            (payload?.data || {}) as Parameters<typeof createSsoProvider>[0]
          )
        );
      case 'sso.updateSsoProvider':
        return toResultResponse(
          await updateSsoProvider(
            String(payload?.id || ''),
            (payload?.data || {}) as Parameters<typeof updateSsoProvider>[1]
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
          await updateSsoProviderOrder(
            (payload?.updates || []) as Parameters<
              typeof updateSsoProviderOrder
            >[0],
            actorUserId
          )
        );
      default:
        return toErrorResponse(`Unsupported action: ${action}`, 400);
    }
  } catch (error) {
    console.error('[InternalDataAPI] Unhandled error:', error);
    return toErrorResponse('Internal server error', 500);
  }
}
