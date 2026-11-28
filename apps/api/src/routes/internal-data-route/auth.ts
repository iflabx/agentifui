import type { FastifyRequest } from 'fastify';
import type { PoolClient } from 'pg';

import type { ApiRuntimeConfig } from '../../config';
import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import {
  type ProfileStatusIdentity,
  resolveProfileStatusFromSession,
} from '../../lib/session-identity';
import {
  resolvePayloadUserId,
  sanitizeExecution,
  toErrorResponse,
} from './helpers';
import {
  ADMIN_ACTIONS,
  AUTH_ACTIONS,
  type ApiActionResponse,
  type AppExecutionRow,
} from './types';

export async function resolveActorIdentity(
  request: FastifyRequest,
  config: ApiRuntimeConfig,
  current = false
): Promise<
  | { ok: true; identity: ProfileStatusIdentity }
  | { ok: false; error: ApiActionResponse }
> {
  const resolved = await resolveProfileStatusFromSession(request, config, {
    bypassCache: current,
  });
  if (resolved.kind === 'unauthorized') {
    return {
      ok: false,
      error: toErrorResponse('Unauthorized', 401),
    };
  }
  if (resolved.kind === 'error') {
    return {
      ok: false,
      error: toErrorResponse('Failed to verify session', 500),
    };
  }
  return { ok: true, identity: resolved.identity };
}

export async function ensureActionPermission(
  request: FastifyRequest,
  config: ApiRuntimeConfig,
  action: string,
  payload: Record<string, unknown> | undefined
): Promise<{ error: ApiActionResponse | null; actorUserId?: string }> {
  if (ADMIN_ACTIONS.has(action)) {
    const resolved = await resolveActorIdentity(request, config, true);
    if (!resolved.ok) {
      const status = resolved.error.statusCode;
      if (status === 401) {
        return {
          error: toErrorResponse('Unauthorized access', 401),
        };
      }
      return {
        error: toErrorResponse('Failed to verify permissions', 500),
      };
    }

    if (resolved.identity.role !== 'admin') {
      return {
        error: toErrorResponse('Insufficient permissions', 403),
        actorUserId: resolved.identity.userId,
      };
    }

    return { error: null, actorUserId: resolved.identity.userId };
  }

  if (AUTH_ACTIONS.has(action)) {
    const resolved = await resolveActorIdentity(
      request,
      config,
      action.startsWith('appExecutions.') ||
        action === 'messages.searchHistory' ||
        action === 'messages.getHistoryMatch'
    );
    if (!resolved.ok) {
      return { error: resolved.error };
    }

    const payloadUserId = resolvePayloadUserId(payload);
    if (payloadUserId && payloadUserId !== resolved.identity.userId) {
      return {
        error: toErrorResponse('Forbidden', 403),
      };
    }

    return { error: null, actorUserId: resolved.identity.userId };
  }

  return { error: toErrorResponse('Unsupported or unauthorized action', 403) };
}

export async function loadConversationOwnedByActor(
  conversationId: string,
  actorUserId: string,
  access: 'read' | 'write' | 'chatflow-inputs' = 'read',
  client?: Pick<PoolClient, 'query'>
): Promise<boolean> {
  const sql = `
      SELECT id::text
      FROM conversations
      WHERE id = $1::uuid
        AND user_id = $2::uuid
        AND conversations.status = 'active'
        AND ${access === 'read' ? boundConversationAccessSql('$2') : unboundConversationAccessSql('$2')}
        ${access === 'chatflow-inputs' ? 'AND conversations.app_id IS NOT NULL' : ''}
      LIMIT 1
    `;
  const params = [conversationId, actorUserId];
  const rows = client
    ? (await client.query<{ id: string }>(sql, params)).rows
    : await queryRowsWithPgSystemContext<{ id: string }>(sql, params, {
        statementTimeoutMs: 5000,
      });

  return Boolean(rows[0]?.id);
}

export const unboundConversationSql = `NOT EXISTS (
  SELECT 1 FROM backend_conversations binding
  WHERE binding.conversation_id = conversations.id
 ) AND COALESCE(conversations.metadata ->> 'runtime', '') <> 'dify-task'`;

function unboundConversationAccessSql(actorParameter: '$1' | '$2'): string {
  return `(${unboundConversationSql}
    AND (conversations.app_id IS NULL OR ${appAccessSql(
      `(SELECT legacy_instance.id FROM service_instances legacy_instance
        WHERE legacy_instance.id::text = conversations.app_id
          OR legacy_instance.instance_id = conversations.app_id
        ORDER BY (legacy_instance.id::text = conversations.app_id) DESC, legacy_instance.id
        LIMIT 1)`,
      `${actorParameter}::uuid`
    )}))`;
}

export function boundConversationAccessSql(
  actorParameter: '$1' | '$2'
): string {
  return `(
    ${unboundConversationAccessSql(actorParameter)}
    OR (
      conversations.metadata ->> 'runtime' = 'dify-task'
      AND conversations.status = 'active'
      AND ${appAccessSql('conversations.app_id', `${actorParameter}::uuid`)}
    )
    OR EXISTS (
      SELECT 1
      FROM backend_conversations binding
      JOIN service_instances instance ON instance.id = binding.service_instance_id
      JOIN providers provider ON provider.id = instance.provider_id
      JOIN profiles actor ON actor.id = ${actorParameter}::uuid
      WHERE binding.conversation_id = conversations.id
        AND conversations.status = 'active'
        AND actor.status = 'active'
        AND provider.is_active = TRUE
        AND COALESCE(instance.config ->> 'backend_type', 'dify') = binding.backend_type
        AND binding.backend_type IN ('langchain', 'dify')
        AND (
          instance.visibility = 'public'
          OR actor.role = 'admin'
          OR (instance.visibility = 'group_only' AND EXISTS (
            SELECT 1 FROM group_app_permissions permission
            JOIN group_members member ON member.group_id = permission.group_id
            WHERE permission.service_instance_id = instance.id
              AND permission.is_enabled = TRUE
              AND member.user_id = actor.id
          ))
        )
    )
  )`;
}

export function appAccessSql(
  appExpression: string,
  actorExpression: string
): string {
  return `EXISTS (
    SELECT 1 FROM service_instances access_instance
    JOIN providers access_provider ON access_provider.id = access_instance.provider_id
    JOIN profiles access_actor ON access_actor.id = ${actorExpression}
    WHERE access_instance.id::text = (${appExpression})::text
      AND access_actor.status = 'active'
      AND access_provider.is_active = TRUE
      AND (
        access_actor.role = 'admin' OR access_instance.visibility = 'public'
        OR (access_instance.visibility = 'group_only' AND EXISTS (
          SELECT 1 FROM group_app_permissions access_permission
          JOIN group_members access_member ON access_member.group_id = access_permission.group_id
          WHERE access_permission.service_instance_id = access_instance.id
            AND access_permission.is_enabled = TRUE
            AND access_member.user_id = access_actor.id
        ))
      )
  )`;
}

export function executionAccessSql(actorParameter: string): string {
  return `app_executions.user_id = ${actorParameter}::uuid
    AND app_executions.status <> 'deleted'::execution_status
    AND ${appAccessSql('app_executions.service_instance_id', `${actorParameter}::uuid`)}
    AND (app_executions.conversation_id IS NULL OR EXISTS (
      SELECT 1 FROM conversations execution_conversation
      WHERE execution_conversation.id = app_executions.conversation_id
        AND execution_conversation.user_id = ${actorParameter}::uuid
        AND execution_conversation.app_id = app_executions.service_instance_id::text
        AND execution_conversation.status = 'active'
    ))`;
}

export async function loadExecutionOwnedByActor(
  executionId: string,
  actorUserId: string
): Promise<AppExecutionRow | null> {
  const rows = await queryRowsWithPgSystemContext<AppExecutionRow>(
    `
      SELECT
        id::text,
        user_id::text,
        service_instance_id::text,
        conversation_id::text,
        submission_id::text,
        execution_type::text,
        external_execution_id,
        task_id,
        title,
        inputs,
        outputs,
        status::text,
        error_message,
        total_steps,
        total_tokens,
        elapsed_time,
        metadata,
        created_at::text,
        updated_at::text,
        completed_at::text
      FROM app_executions
      WHERE id = $1::uuid
        AND ${executionAccessSql('$2')}
      LIMIT 1
    `,
    [executionId, actorUserId],
    { statementTimeoutMs: 5000 }
  );

  return rows[0] ? sanitizeExecution(rows[0]) : null;
}
