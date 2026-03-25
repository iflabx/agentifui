import type { FastifyRequest } from 'fastify';

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
  config: ApiRuntimeConfig
): Promise<
  | { ok: true; identity: ProfileStatusIdentity }
  | { ok: false; error: ApiActionResponse }
> {
  const resolved = await resolveProfileStatusFromSession(request, config);
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
    const resolved = await resolveActorIdentity(request, config);
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
      };
    }

    return { error: null, actorUserId: resolved.identity.userId };
  }

  if (AUTH_ACTIONS.has(action)) {
    const resolved = await resolveActorIdentity(request, config);
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

  return { error: null };
}

export async function loadConversationOwnedByActor(
  conversationId: string,
  actorUserId: string
): Promise<boolean> {
  const rows = await queryRowsWithPgSystemContext<{ id: string }>(
    `
      SELECT id::text
      FROM conversations
      WHERE id = $1::uuid
        AND user_id = $2::uuid
      LIMIT 1
    `,
    [conversationId, actorUserId]
  );

  return Boolean(rows[0]?.id);
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
        AND user_id = $2::uuid
      LIMIT 1
    `,
    [executionId, actorUserId]
  );

  return rows[0] ? sanitizeExecution(rows[0]) : null;
}
