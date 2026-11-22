import type { PoolClient } from 'pg';

import { submissionHash } from '../../lib/agent-submissions';
import { runWithPgSystemContext } from '../../lib/pg-context';
import { appAccessSql, executionAccessSql } from './auth';
import {
  readString,
  sanitizeExecution,
  toErrorResponse,
  toSuccessResponse,
} from './helpers';
import type { ApiActionResponse, AppExecutionRow } from './types';

const UUID_PATTERN = /^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i;

export function isTaskUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export const EXECUTION_COLUMNS = `
  id::text, user_id::text, service_instance_id::text,
  conversation_id::text, submission_id::text, execution_type::text,
  external_execution_id, task_id, title, inputs, outputs, status::text,
  error_message, total_steps, total_tokens, elapsed_time, metadata,
  created_at::text, updated_at::text, completed_at::text`;

export async function updateAccessibleExecution(
  executionId: string,
  actorUserId: string,
  updates: string[],
  values: unknown[],
  allowInterruptedDelete = false
): Promise<AppExecutionRow[]> {
  return runWithPgSystemContext(async client => {
    const linked = await client.query<{ conversation_id: string | null }>(
      `SELECT conversation_id::text FROM app_executions
       WHERE id = $1::uuid AND user_id = $2::uuid`,
      [executionId, actorUserId]
    );
    if (!linked.rows[0]) return [];
    if (linked.rows[0].conversation_id) {
      await client.query(
        `SELECT id FROM conversations WHERE id = $1::uuid AND user_id = $2::uuid FOR UPDATE`,
        [linked.rows[0].conversation_id, actorUserId]
      );
    }
    const idParameter = `$${values.length + 1}`;
    const actorParameter = `$${values.length + 2}`;
    const result = await client.query<AppExecutionRow>(
      `UPDATE app_executions SET ${updates.join(', ')}
       WHERE id = ${idParameter}::uuid AND ${executionAccessSql(actorParameter)}
         ${allowInterruptedDelete ? '' : "AND (conversation_id IS NULL OR error_message IS DISTINCT FROM 'CLIENT_TASK_INTERRUPTED')"}
       RETURNING ${EXECUTION_COLUMNS}`,
      [...values, executionId, actorUserId]
    );
    return result.rows;
  });
}

async function reserveTask(
  client: PoolClient,
  payload: Record<string, unknown>,
  actorUserId: string
): Promise<ApiActionResponse> {
  const serviceInstanceId = (payload.serviceInstanceId as string).toLowerCase();
  const submissionId = (payload.submissionId as string).toLowerCase();
  const conversationId =
    typeof payload.conversationId === 'string'
      ? payload.conversationId.toLowerCase()
      : null;
  const title = readString(payload.title);
  const inputs = payload.inputs as Record<string, unknown>;

  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `task-reservation:${actorUserId}:${serviceInstanceId}:${submissionId}`,
  ]);
  const app = await client.query<{ task_type: 'workflow' | 'text-generation' }>(
    `SELECT instance.config #>> '{app_metadata,dify_apptype}' AS task_type
     FROM service_instances instance JOIN providers provider ON provider.id = instance.provider_id
     WHERE instance.id = $1::uuid AND provider.type IN ('dify', 'llm')
       AND COALESCE(instance.config ->> 'backend_type', 'dify') = 'dify'
       AND COALESCE(instance.config ->> 'interaction_protocol', 'native') = 'native'
       AND instance.config #>> '{app_metadata,dify_apptype}' IN ('workflow', 'text-generation')
       AND ${appAccessSql('instance.id', '$2::uuid')}`,
    [serviceInstanceId, actorUserId]
  );
  if (!app.rows[0])
    return toErrorResponse('Task app unavailable or forbidden', 404);

  const existing = await client.query<AppExecutionRow>(
    `SELECT ${EXECUTION_COLUMNS} FROM app_executions
     WHERE user_id = $1::uuid AND service_instance_id = $2::uuid AND submission_id = $3::uuid`,
    [actorUserId, serviceInstanceId, submissionId]
  );
  const prior = existing.rows[0];
  if (prior) {
    if (
      (conversationId && conversationId !== prior.conversation_id) ||
      submissionHash({ inputs, title }) !==
        submissionHash({ inputs: prior.inputs, title: prior.title })
    )
      return toErrorResponse(
        'Submission content or conversation conflict',
        409
      );
    if (!prior.conversation_id)
      return toErrorResponse('Submission unavailable', 409);
    const active = await client.query<{ id: string }>(
      `SELECT id::text FROM conversations
       WHERE id = $1::uuid AND user_id = $2::uuid AND app_id = $3
         AND status = 'active' AND metadata ->> 'runtime' = 'dify-task'
         AND NOT EXISTS (SELECT 1 FROM backend_conversations binding WHERE binding.conversation_id = conversations.id)
       FOR UPDATE`,
      [prior.conversation_id, actorUserId, serviceInstanceId]
    );
    if (!active.rows[0] || prior.status === 'deleted')
      return toErrorResponse('Execution deleted or unavailable', 409);
    const refreshed = await client.query<AppExecutionRow>(
      `SELECT ${EXECUTION_COLUMNS} FROM app_executions
       WHERE id = $1::uuid AND ${executionAccessSql('$2')}`,
      [prior.id, actorUserId]
    );
    if (!refreshed.rows[0])
      return toErrorResponse('Execution deleted or unavailable', 409);
    return toSuccessResponse({
      execution: sanitizeExecution(refreshed.rows[0]),
      conversationId: prior.conversation_id,
      replayed: true,
    });
  }

  let reservedConversationId = conversationId;
  if (conversationId) {
    const active = await client.query<{ id: string }>(
      `SELECT id::text FROM conversations
       WHERE id = $1::uuid AND user_id = $2::uuid AND app_id = $3
         AND status = 'active' AND metadata ->> 'runtime' = 'dify-task'
         AND metadata ->> 'task_type' = $4
         AND NOT EXISTS (SELECT 1 FROM backend_conversations binding WHERE binding.conversation_id = conversations.id)
       FOR UPDATE`,
      [conversationId, actorUserId, serviceInstanceId, app.rows[0].task_type]
    );
    if (!active.rows[0])
      return toErrorResponse('Task conversation unavailable', 409);
    const pending = await client.query<{ id: string }>(
      `SELECT id FROM app_executions WHERE conversation_id = $1::uuid
       AND status IN ('pending', 'running') LIMIT 1`,
      [conversationId]
    );
    if (pending.rows[0])
      return toErrorResponse('Task conversation has an active execution', 409);
  } else {
    const created = await client.query<{ id: string }>(
      `INSERT INTO conversations(user_id, app_id, title, status, metadata)
       VALUES ($1::uuid, $2, $3, 'active', $4::jsonb) RETURNING id::text`,
      [
        actorUserId,
        serviceInstanceId,
        title,
        JSON.stringify({
          runtime: 'dify-task',
          task_type: app.rows[0].task_type,
        }),
      ]
    );
    reservedConversationId = created.rows[0].id;
  }
  const result = await client.query<AppExecutionRow>(
    `INSERT INTO app_executions(user_id, service_instance_id, conversation_id, submission_id,
       execution_type, title, inputs, status)
     VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::execution_type, $6, $7::jsonb, 'pending')
     RETURNING ${EXECUTION_COLUMNS}`,
    [
      actorUserId,
      serviceInstanceId,
      reservedConversationId,
      submissionId,
      app.rows[0].task_type,
      title,
      JSON.stringify(inputs),
    ]
  );
  await client.query(
    `UPDATE conversations SET updated_at = NOW(), last_message_preview = $3
     WHERE id = $1::uuid AND user_id = $2::uuid AND status = 'active'`,
    [reservedConversationId, actorUserId, title.slice(0, 160)]
  );
  return toSuccessResponse({
    execution: sanitizeExecution(result.rows[0]),
    conversationId: reservedConversationId,
    replayed: false,
  });
}

export async function handleTaskExecutionAction(
  action: string,
  payload: Record<string, unknown> | undefined,
  actorUserId: string | undefined
): Promise<ApiActionResponse | null> {
  if (
    action !== 'appExecutions.reserveTask' &&
    action !== 'appExecutions.getByConversation'
  )
    return null;
  if (!actorUserId) return toErrorResponse('Unauthorized', 401);
  if (action === 'appExecutions.reserveTask') {
    if (
      !isTaskUuid(payload?.serviceInstanceId) ||
      !isTaskUuid(payload?.submissionId) ||
      (payload?.conversationId !== undefined &&
        !isTaskUuid(payload.conversationId)) ||
      !payload?.inputs ||
      typeof payload.inputs !== 'object' ||
      Array.isArray(payload.inputs) ||
      !readString(payload.title) ||
      readString(payload.title).length > 500
    )
      return toErrorResponse('Invalid task reservation', 400);
    return runWithPgSystemContext(client =>
      reserveTask(client, payload, actorUserId)
    );
  }

  if (
    !isTaskUuid(payload?.conversationId) ||
    (payload?.cursor !== undefined &&
      payload.cursor !== null &&
      !isTaskUuid(payload.cursor)) ||
    (payload?.limit !== undefined &&
      (typeof payload.limit !== 'number' ||
        !Number.isInteger(payload.limit) ||
        payload.limit < 1))
  ) {
    return toErrorResponse('Invalid history page', 400);
  }
  const conversationId = payload.conversationId.toLowerCase();
  const limit = Math.min(
    typeof payload.limit === 'number' ? payload.limit : 20,
    100
  );
  const cursor =
    typeof payload.cursor === 'string' ? payload.cursor.toLowerCase() : null;
  return runWithPgSystemContext(async client => {
    const conversation = await client.query<{ id: string }>(
      `SELECT id::text FROM conversations WHERE id = $1::uuid AND user_id = $2::uuid
       AND status = 'active' AND metadata ->> 'runtime' = 'dify-task'
       AND ${appAccessSql('conversations.app_id', '$2::uuid')}`,
      [conversationId, actorUserId]
    );
    if (!conversation.rows[0])
      return toErrorResponse('Task conversation not found', 404);
    let boundary: { created_at: string; id: string } | undefined;
    if (cursor) {
      const found = await client.query<{ created_at: string; id: string }>(
        `SELECT created_at::text, id::text FROM app_executions
         WHERE id = $1::uuid AND conversation_id = $2::uuid AND user_id = $3::uuid`,
        [cursor, conversationId, actorUserId]
      );
      boundary = found.rows[0];
      if (!boundary) return toErrorResponse('Invalid history cursor', 400);
    }
    const rows = await client.query<AppExecutionRow>(
      `SELECT ${EXECUTION_COLUMNS} FROM app_executions
       WHERE conversation_id = $1::uuid AND ${executionAccessSql('$2')}
         ${boundary ? 'AND (created_at, id) < ($4::timestamptz, $5::uuid)' : ''}
       ORDER BY created_at DESC, id DESC LIMIT $3`,
      [
        conversationId,
        actorUserId,
        limit + 1,
        ...(boundary ? [boundary.created_at, boundary.id] : []),
      ]
    );
    const hasMore = rows.rows.length > limit;
    const executions = rows.rows
      .slice(0, limit)
      .reverse()
      .map(sanitizeExecution);
    return toSuccessResponse({
      executions,
      hasMore,
      nextCursor: hasMore ? executions[0].id : null,
    });
  });
}
