import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import {
  createApiKey,
  deleteApiKey,
  getApiKeyByServiceInstance,
  updateApiKey,
} from '@lib/db/api-keys';
import {
  createExecution,
  deleteExecution,
  getExecutionById,
  getExecutionsByServiceInstance,
  updateCompleteExecutionData,
  updateExecutionStatus,
} from '@lib/db/app-executions';
import {
  createConversationForUser,
  deleteConversationForUser,
  getConversationByExternalIdForUser,
  getConversationById,
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
  createPlaceholderAssistantMessage,
  getMessageByContentAndRole,
  getMessagesByConversationId,
  saveMessage as saveDbMessage,
} from '@lib/db/messages';
import {
  createProvider,
  deleteProvider,
  getActiveProviders,
  getAllProviders,
  updateProvider,
} from '@lib/db/providers';
import {
  createServiceInstance,
  deleteServiceInstance,
  getServiceInstanceById,
  getServiceInstancesByProvider,
  setDefaultServiceInstance,
  updateServiceInstance,
} from '@lib/db/service-instances';
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
import {
  REQUEST_ID_HEADER,
  buildAppErrorDetail,
  buildAppErrorEnvelope,
  buildAppSuccessEnvelope,
  resolveRequestId,
} from '@lib/errors/app-error';
import {
  getErrorEventSummary,
  getRecentErrorEvents,
  recordErrorEvent,
} from '@lib/server/errors/error-events';
import {
  getRequestErrorContext,
  runWithRequestErrorContext,
  updateRequestErrorContext,
} from '@lib/server/errors/request-context';
import { requireAdmin } from '@lib/services/admin/require-admin';
import type {
  AppExecution,
  ExecutionStatus,
  MessageStatus,
} from '@lib/types/database';
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
  'providers.getAllProviders',
  'providers.getActiveProviders',
  'providers.createProvider',
  'providers.updateProvider',
  'providers.deleteProvider',
  'serviceInstances.getByProvider',
  'serviceInstances.getById',
  'serviceInstances.create',
  'serviceInstances.update',
  'serviceInstances.delete',
  'serviceInstances.setDefault',
  'apiKeys.getByServiceInstance',
  'apiKeys.create',
  'apiKeys.update',
  'apiKeys.delete',
  'sso.getSsoProviders',
  'sso.getSsoProviderStats',
  'sso.getSsoProviderById',
  'sso.createSsoProvider',
  'sso.updateSsoProvider',
  'sso.deleteSsoProvider',
  'sso.toggleSsoProvider',
  'sso.updateSsoProviderOrder',
  'errors.getSummary',
  'errors.getRecent',
]);

const AUTH_ACTIONS = new Set([
  'groups.getUserAccessibleApps',
  'groups.checkUserAppPermission',
  'groups.incrementAppUsage',
  'conversations.getConversationByExternalId',
  'conversations.createConversation',
  'conversations.getUserConversations',
  'conversations.renameConversation',
  'conversations.deleteConversation',
  'messages.getLatest',
  'messages.findDuplicate',
  'messages.save',
  'messages.createPlaceholder',
  'appExecutions.getByServiceInstance',
  'appExecutions.getById',
  'appExecutions.create',
  'appExecutions.updateStatus',
  'appExecutions.updateComplete',
  'appExecutions.delete',
]);

const MESSAGE_STATUSES = new Set<MessageStatus>(['sent', 'delivered', 'error']);

const EXECUTION_STATUSES = new Set<ExecutionStatus>([
  'pending',
  'running',
  'completed',
  'failed',
  'stopped',
  'deleted',
]);

type ErrorResponseOptions = {
  code?: string;
  developerMessage?: string;
  retryable?: boolean;
  context?: Record<string, unknown>;
};

function toErrorResponse(
  message: string,
  status: number,
  options: ErrorResponseOptions = {}
) {
  const requestContext = getRequestErrorContext();
  const requestId = requestContext?.requestId || resolveRequestId();
  const detail = buildAppErrorDetail({
    status,
    source: requestContext?.source || 'next-api',
    requestId,
    code: options.code,
    userMessage: message,
    developerMessage: options.developerMessage,
    retryable: options.retryable,
    context: options.context,
  });
  const payload = buildAppErrorEnvelope(detail, message);
  const response = NextResponse.json(payload, { status });
  response.headers.set(REQUEST_ID_HEADER, requestId);

  void recordErrorEvent({
    code: detail.code,
    source: detail.source,
    severity: detail.severity,
    retryable: detail.retryable,
    userMessage: detail.userMessage,
    developerMessage: detail.developerMessage,
    requestId,
    actorUserId: requestContext?.actorUserId,
    httpStatus: status,
    method: requestContext?.method,
    route: requestContext?.route,
    context: options.context,
  }).catch(error => {
    console.warn(
      '[InternalDataAPI] failed to record error event:',
      error instanceof Error ? error.message : String(error)
    );
  });

  return response;
}

function toSuccessResponse<T>(data: T) {
  const requestContext = getRequestErrorContext();
  const requestId = requestContext?.requestId;
  const response = NextResponse.json(buildAppSuccessEnvelope(data, requestId));
  if (requestId) {
    response.headers.set(REQUEST_ID_HEADER, requestId);
  }
  return response;
}

function toResultResponse<T>(result: Result<T>) {
  if (result.success) {
    return toSuccessResponse(result.data);
  }

  return toErrorResponse(result.error?.message || 'Unknown error', 500, {
    developerMessage: result.error?.stack,
  });
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

function parseExecutionStatus(value: unknown): ExecutionStatus | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim() as ExecutionStatus;
  if (!EXECUTION_STATUSES.has(normalized)) {
    return null;
  }

  return normalized;
}

function parseMessageStatus(value: unknown): MessageStatus | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim() as MessageStatus;
  if (!MESSAGE_STATUSES.has(normalized)) {
    return null;
  }

  return normalized;
}

async function ensureConversationOwnedByActor(
  conversationId: string,
  actorUserId: string | undefined
): Promise<{
  error: NextResponse | null;
}> {
  if (!actorUserId) {
    return { error: toErrorResponse('Unauthorized', 401) };
  }

  const conversationResult = await getConversationById(conversationId);
  if (!conversationResult.success) {
    return {
      error: toErrorResponse(
        conversationResult.error?.message ||
          'Failed to load conversation record',
        500
      ),
    };
  }

  const conversation = conversationResult.data;
  if (!conversation || conversation.user_id !== actorUserId) {
    return { error: toErrorResponse('Conversation not found', 404) };
  }

  return { error: null };
}

async function ensureExecutionOwnedByActor(
  executionId: string,
  actorUserId: string | undefined
): Promise<{
  error: NextResponse | null;
  execution?: AppExecution;
}> {
  if (!actorUserId) {
    return { error: toErrorResponse('Unauthorized', 401) };
  }

  const executionResult = await getExecutionById(executionId, actorUserId);
  if (!executionResult.success) {
    return {
      error: toErrorResponse(
        executionResult.error?.message || 'Failed to load execution record',
        500
      ),
    };
  }

  if (!executionResult.data) {
    return { error: toErrorResponse('Execution record not found', 404) };
  }

  return { error: null, execution: executionResult.data };
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
  const requestId = resolveRequestId(request);
  return runWithRequestErrorContext(
    {
      requestId,
      source: 'next-api',
      route: '/api/internal/data',
      method: 'POST',
    },
    async () => {
      try {
        const body = (await request.json()) as InternalActionRequest;
        const action = body?.action?.trim();
        const payload = body?.payload;

        if (!action) {
          return toErrorResponse('Missing action', 400, {
            code: 'BAD_REQUEST',
          });
        }

        const permission = await ensureActionPermission(
          request,
          action,
          payload
        );
        if (permission.error) {
          return permission.error;
        }
        const actorUserId = permission.actorUserId;
        if (actorUserId) {
          updateRequestErrorContext({ actorUserId });
        }

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
                (payload?.updates || {}) as Parameters<
                  typeof updateUserProfile
                >[1]
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
                (payload?.data || {}) as Parameters<
                  typeof setGroupAppPermission
                >[2]
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
          case 'providers.getAllProviders':
            return toResultResponse(await getAllProviders());
          case 'providers.getActiveProviders':
            return toResultResponse(await getActiveProviders());
          case 'providers.createProvider':
            return toResultResponse(
              await createProvider(
                (payload?.provider || {}) as Parameters<
                  typeof createProvider
                >[0]
              )
            );
          case 'providers.updateProvider':
            return toResultResponse(
              await updateProvider(
                String(payload?.id || ''),
                (payload?.updates || {}) as Parameters<typeof updateProvider>[1]
              )
            );
          case 'providers.deleteProvider':
            return toResultResponse(
              await deleteProvider(String(payload?.id || ''))
            );
          case 'serviceInstances.getByProvider':
            return toResultResponse(
              await getServiceInstancesByProvider(
                String(payload?.providerId || '')
              )
            );
          case 'serviceInstances.getById':
            return toResultResponse(
              await getServiceInstanceById(String(payload?.id || ''))
            );
          case 'serviceInstances.create':
            return toResultResponse(
              await createServiceInstance(
                (payload?.serviceInstance || {}) as Parameters<
                  typeof createServiceInstance
                >[0]
              )
            );
          case 'serviceInstances.update':
            return toResultResponse(
              await updateServiceInstance(
                String(payload?.id || ''),
                (payload?.updates || {}) as Parameters<
                  typeof updateServiceInstance
                >[1]
              )
            );
          case 'serviceInstances.delete':
            return toResultResponse(
              await deleteServiceInstance(String(payload?.id || ''))
            );
          case 'serviceInstances.setDefault':
            return toResultResponse(
              await setDefaultServiceInstance(String(payload?.instanceId || ''))
            );
          case 'apiKeys.getByServiceInstance':
            return toResultResponse(
              await getApiKeyByServiceInstance(
                String(payload?.serviceInstanceId || '')
              )
            );
          case 'apiKeys.create':
            return toResultResponse(
              await createApiKey(
                (payload?.apiKey || {}) as Parameters<typeof createApiKey>[0],
                Boolean(payload?.isEncrypted)
              )
            );
          case 'apiKeys.update':
            return toResultResponse(
              await updateApiKey(
                String(payload?.id || ''),
                (payload?.updates || {}) as Parameters<typeof updateApiKey>[1],
                Boolean(payload?.isEncrypted)
              )
            );
          case 'apiKeys.delete':
            return toResultResponse(
              await deleteApiKey(String(payload?.id || ''))
            );
          case 'conversations.getUserConversations': {
            const userId = (
              actorUserId || requireString(payload, 'userId')
            ).trim();
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
          case 'conversations.getConversationByExternalId': {
            const userId = (
              actorUserId || requireString(payload, 'userId')
            ).trim();
            const externalId = requireString(payload, 'externalId');
            if (!userId || !externalId) {
              return toErrorResponse('Missing required fields', 400);
            }

            return toResultResponse(
              await getConversationByExternalIdForUser(userId, externalId)
            );
          }
          case 'conversations.createConversation': {
            const userId = (
              actorUserId || requireString(payload, 'userId')
            ).trim();
            const conversation = (payload?.conversation || {}) as Parameters<
              typeof createConversationForUser
            >[1];

            if (!userId) {
              return toErrorResponse('Missing userId', 400);
            }

            return toResultResponse(
              await createConversationForUser(userId, conversation)
            );
          }
          case 'conversations.renameConversation': {
            const userId = (
              actorUserId || requireString(payload, 'userId')
            ).trim();
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
            const userId = (
              actorUserId || requireString(payload, 'userId')
            ).trim();
            const conversationId = requireString(payload, 'conversationId');
            if (!userId || !conversationId) {
              return toErrorResponse('Missing required fields', 400);
            }

            return toResultResponse(
              await deleteConversationForUser(userId, conversationId)
            );
          }
          case 'messages.getLatest': {
            const conversationId = requireString(payload, 'conversationId');
            const limit = Math.min(
              parsePositiveInt(payload?.limit, 1000),
              5000
            );

            if (!conversationId) {
              return toErrorResponse('Missing conversationId', 400);
            }

            const owned = await ensureConversationOwnedByActor(
              conversationId,
              actorUserId
            );
            if (owned.error) {
              return owned.error;
            }

            return toResultResponse(
              await getMessagesByConversationId(conversationId, limit)
            );
          }
          case 'messages.findDuplicate': {
            const conversationId = requireString(payload, 'conversationId');
            const content = requireString(payload, 'content');
            const roleRaw = requireString(payload, 'role');
            const role =
              roleRaw === 'user' ||
              roleRaw === 'assistant' ||
              roleRaw === 'system'
                ? roleRaw
                : null;

            if (!conversationId || !content || !role) {
              return toErrorResponse('Missing required fields', 400);
            }

            const owned = await ensureConversationOwnedByActor(
              conversationId,
              actorUserId
            );
            if (owned.error) {
              return owned.error;
            }

            return toResultResponse(
              await getMessageByContentAndRole(content, role, conversationId)
            );
          }
          case 'messages.save': {
            const message = (payload?.message || {}) as Partial<{
              conversation_id: string;
              user_id?: string | null;
              role: 'user' | 'assistant' | 'system';
              content: string;
              metadata?: Record<string, unknown>;
              status?: MessageStatus;
              external_id?: string | null;
              token_count?: number | null;
              sequence_index?: number;
            }>;

            if (
              !message.conversation_id ||
              !message.role ||
              !message.content ||
              !['user', 'assistant', 'system'].includes(message.role)
            ) {
              return toErrorResponse('Missing required fields', 400);
            }

            const owned = await ensureConversationOwnedByActor(
              message.conversation_id,
              actorUserId
            );
            if (owned.error) {
              return owned.error;
            }

            const status =
              message.status === undefined
                ? undefined
                : parseMessageStatus(message.status);
            if (message.status !== undefined && !status) {
              return toErrorResponse('Invalid status', 400);
            }

            const sanitizedMessage: {
              conversation_id: string;
              user_id?: string | null;
              role: 'user' | 'assistant' | 'system';
              content: string;
              metadata?: Record<string, unknown>;
              status?: MessageStatus;
              external_id?: string | null;
              token_count?: number | null;
              sequence_index?: number;
            } = {
              conversation_id: message.conversation_id,
              user_id: message.role === 'user' ? actorUserId || null : null,
              role: message.role,
              content: message.content,
              ...(message.metadata ? { metadata: message.metadata } : {}),
              ...(status ? { status } : {}),
              ...(message.external_id !== undefined
                ? { external_id: message.external_id }
                : {}),
              ...(message.token_count !== undefined
                ? { token_count: message.token_count }
                : {}),
              ...(message.sequence_index !== undefined
                ? { sequence_index: message.sequence_index }
                : {}),
            };

            return toResultResponse(await saveDbMessage(sanitizedMessage));
          }
          case 'messages.createPlaceholder': {
            const conversationId = requireString(payload, 'conversationId');
            const statusRaw = payload?.status;
            const status = statusRaw ? parseMessageStatus(statusRaw) : null;
            const errorMessage =
              typeof payload?.errorMessage === 'string'
                ? payload.errorMessage
                : null;

            if (!conversationId) {
              return toErrorResponse('Missing conversationId', 400);
            }

            const owned = await ensureConversationOwnedByActor(
              conversationId,
              actorUserId
            );
            if (owned.error) {
              return owned.error;
            }

            if (statusRaw !== undefined && !status) {
              return toErrorResponse('Invalid status', 400);
            }

            return toResultResponse(
              await createPlaceholderAssistantMessage(
                conversationId,
                status || 'error',
                errorMessage
              )
            );
          }
          case 'appExecutions.getByServiceInstance': {
            const userId = (
              actorUserId || requireString(payload, 'userId')
            ).trim();
            const serviceInstanceId = requireString(
              payload,
              'serviceInstanceId'
            );
            const limit = Math.min(parsePositiveInt(payload?.limit, 10), 100);

            if (!userId || !serviceInstanceId) {
              return toErrorResponse('Missing required fields', 400);
            }

            return toResultResponse(
              await getExecutionsByServiceInstance(
                serviceInstanceId,
                userId,
                limit
              )
            );
          }
          case 'appExecutions.getById': {
            const userId = (
              actorUserId || requireString(payload, 'userId')
            ).trim();
            const executionId = requireString(payload, 'executionId');

            if (!userId || !executionId) {
              return toErrorResponse('Missing required fields', 400);
            }

            return toResultResponse(
              await getExecutionById(executionId, userId)
            );
          }
          case 'appExecutions.create': {
            if (!actorUserId) {
              return toErrorResponse('Unauthorized', 401);
            }

            const executionInput = (payload?.execution || {}) as Partial<
              Omit<AppExecution, 'id' | 'created_at' | 'updated_at'>
            >;

            if (
              !executionInput.service_instance_id ||
              !executionInput.execution_type ||
              !executionInput.title
            ) {
              return toErrorResponse('Missing required fields', 400);
            }

            const execution: Omit<
              AppExecution,
              'id' | 'created_at' | 'updated_at'
            > = {
              ...executionInput,
              user_id: actorUserId,
            } as Omit<AppExecution, 'id' | 'created_at' | 'updated_at'>;

            return toResultResponse(await createExecution(execution));
          }
          case 'appExecutions.updateStatus': {
            const executionId = requireString(payload, 'executionId');
            const status = parseExecutionStatus(payload?.status);
            const errorMessage =
              typeof payload?.errorMessage === 'string'
                ? payload.errorMessage
                : undefined;
            const completedAt =
              typeof payload?.completedAt === 'string'
                ? payload.completedAt
                : undefined;

            if (!executionId || !status) {
              return toErrorResponse('Missing required fields', 400);
            }

            const owned = await ensureExecutionOwnedByActor(
              executionId,
              actorUserId
            );
            if (owned.error) {
              return owned.error;
            }

            return toResultResponse(
              await updateExecutionStatus(
                executionId,
                status,
                errorMessage,
                completedAt
              )
            );
          }
          case 'appExecutions.updateComplete': {
            const executionId = requireString(payload, 'executionId');
            if (!executionId) {
              return toErrorResponse('Missing executionId', 400);
            }

            const completeData = (payload?.completeData || {}) as Parameters<
              typeof updateCompleteExecutionData
            >[1];
            const status = parseExecutionStatus(completeData?.status);
            if (!status) {
              return toErrorResponse('Invalid status', 400);
            }

            const owned = await ensureExecutionOwnedByActor(
              executionId,
              actorUserId
            );
            if (owned.error) {
              return owned.error;
            }

            return toResultResponse(
              await updateCompleteExecutionData(executionId, {
                ...completeData,
                status,
              })
            );
          }
          case 'appExecutions.delete': {
            const userId = (
              actorUserId || requireString(payload, 'userId')
            ).trim();
            const executionId = requireString(payload, 'executionId');
            if (!userId || !executionId) {
              return toErrorResponse('Missing required fields', 400);
            }

            return toResultResponse(await deleteExecution(executionId, userId));
          }
          case 'sso.getSsoProviders':
            return toResultResponse(
              await getSsoProviders(
                (payload?.filters || {}) as Parameters<
                  typeof getSsoProviders
                >[0]
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
          case 'errors.getSummary': {
            const hours = Math.min(parsePositiveInt(payload?.hours, 24), 720);
            return toSuccessResponse(await getErrorEventSummary(hours));
          }
          case 'errors.getRecent': {
            const limit = Math.min(parsePositiveInt(payload?.limit, 50), 200);
            const offset = parsePositiveInt(payload?.offset, 0);
            return toSuccessResponse(await getRecentErrorEvents(limit, offset));
          }
          default:
            return toErrorResponse(`Unsupported action: ${action}`, 400, {
              code: 'BAD_REQUEST',
            });
        }
      } catch (error) {
        console.error('[InternalDataAPI] Unhandled error:', error);
        return toErrorResponse('Internal server error', 500, {
          code: 'INTERNAL_ERROR',
          developerMessage:
            error instanceof Error ? error.message : String(error),
        });
      }
    }
  );
}
