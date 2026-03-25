import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import { loadExecutionOwnedByActor } from './auth';
import {
  normalizeNullableTextValue,
  parseExecutionStatus,
  parseExecutionType,
  parsePositiveInt,
  readObject,
  readString,
  sanitizeExecution,
  toErrorResponse,
  toSuccessResponse,
} from './helpers';
import {
  type ApiActionResponse,
  type AppExecutionRow,
  LOCAL_APP_EXECUTION_ACTIONS,
  TERMINAL_EXECUTION_STATUSES,
} from './types';

export async function handleAppExecutionAction(
  action: string,
  payload: Record<string, unknown> | undefined,
  actorUserId: string | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_APP_EXECUTION_ACTIONS.has(action)) {
    return null;
  }

  const resolvedUserId = (actorUserId || readString(payload?.userId)).trim();

  if (action === 'appExecutions.getUserExecutions') {
    const limit = Math.min(parsePositiveInt(payload?.limit, 20), 100);
    const requestedExecutionType = payload?.executionType;
    const executionType =
      requestedExecutionType === undefined
        ? null
        : parseExecutionType(requestedExecutionType);

    if (!resolvedUserId) {
      return toErrorResponse('Missing required fields', 400);
    }

    if (requestedExecutionType !== undefined && !executionType) {
      return toErrorResponse('Invalid execution type', 400);
    }

    const params: unknown[] = [resolvedUserId];
    let executionTypeClause = '';

    if (executionType) {
      params.push(executionType);
      executionTypeClause = `AND execution_type = $${params.length}`;
    }

    params.push(limit);

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
        WHERE user_id = $1::uuid
          AND status <> 'deleted'::execution_status
          ${executionTypeClause}
        ORDER BY updated_at DESC, created_at DESC
        LIMIT $${params.length}
      `,
      params
    );

    return toSuccessResponse(rows.map(sanitizeExecution));
  }

  if (action === 'appExecutions.getByServiceInstance') {
    const serviceInstanceId = readString(payload?.serviceInstanceId);
    const limit = Math.min(parsePositiveInt(payload?.limit, 10), 100);

    if (!resolvedUserId || !serviceInstanceId) {
      return toErrorResponse('Missing required fields', 400);
    }

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
        WHERE service_instance_id = $1::uuid
          AND user_id = $2::uuid
          AND status <> 'deleted'::execution_status
        ORDER BY created_at DESC
        LIMIT $3
      `,
      [serviceInstanceId, resolvedUserId, limit]
    );

    return toSuccessResponse(rows.map(sanitizeExecution));
  }

  if (action === 'appExecutions.getById') {
    const executionId = readString(payload?.executionId);
    if (!resolvedUserId || !executionId) {
      return toErrorResponse('Missing required fields', 400);
    }

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
      [executionId, resolvedUserId]
    );

    return toSuccessResponse(rows[0] ? sanitizeExecution(rows[0]) : null);
  }

  if (action === 'appExecutions.create') {
    if (!actorUserId) {
      return toErrorResponse('Unauthorized', 401);
    }

    const execution =
      payload?.execution &&
      typeof payload.execution === 'object' &&
      !Array.isArray(payload.execution)
        ? (payload.execution as Record<string, unknown>)
        : {};

    const serviceInstanceId = readString(execution.service_instance_id);
    const executionType = parseExecutionType(execution.execution_type);
    const title = readString(execution.title);
    const parsedStatus =
      execution.status === undefined
        ? 'pending'
        : parseExecutionStatus(execution.status);

    if (!serviceInstanceId || !executionType || !title) {
      return toErrorResponse('Missing required fields', 400);
    }
    if (!parsedStatus) {
      return toErrorResponse('Invalid status', 400);
    }

    const inputs =
      execution.inputs &&
      typeof execution.inputs === 'object' &&
      !Array.isArray(execution.inputs)
        ? execution.inputs
        : {};
    const outputs =
      execution.outputs &&
      typeof execution.outputs === 'object' &&
      !Array.isArray(execution.outputs)
        ? execution.outputs
        : null;
    const metadata =
      execution.metadata &&
      typeof execution.metadata === 'object' &&
      !Array.isArray(execution.metadata)
        ? execution.metadata
        : {};
    const totalSteps =
      typeof execution.total_steps === 'number' &&
      Number.isFinite(execution.total_steps)
        ? Math.max(0, Math.floor(execution.total_steps))
        : 0;
    const totalTokens =
      typeof execution.total_tokens === 'number' &&
      Number.isFinite(execution.total_tokens)
        ? Math.max(0, Math.floor(execution.total_tokens))
        : 0;
    const elapsedTime =
      typeof execution.elapsed_time === 'number' &&
      Number.isFinite(execution.elapsed_time)
        ? execution.elapsed_time
        : null;
    const completedAt = readString(execution.completed_at) || null;

    const rows = await queryRowsWithPgSystemContext<AppExecutionRow>(
      `
        INSERT INTO app_executions (
          user_id,
          service_instance_id,
          execution_type,
          external_execution_id,
          task_id,
          title,
          inputs,
          outputs,
          status,
          error_message,
          total_steps,
          total_tokens,
          elapsed_time,
          metadata,
          completed_at,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::execution_type,
          $4,
          $5,
          $6,
          $7::jsonb,
          $8::jsonb,
          $9::execution_status,
          $10,
          $11,
          $12,
          $13,
          $14::jsonb,
          $15::timestamptz,
          NOW(),
          NOW()
        )
        RETURNING
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
      `,
      [
        actorUserId,
        serviceInstanceId,
        executionType,
        readString(execution.external_execution_id) || null,
        readString(execution.task_id) || null,
        title,
        JSON.stringify(inputs),
        JSON.stringify(outputs),
        parsedStatus,
        readString(execution.error_message) || null,
        totalSteps,
        totalTokens,
        elapsedTime,
        JSON.stringify(metadata),
        completedAt,
      ]
    );

    return toSuccessResponse(rows[0] ? sanitizeExecution(rows[0]) : null);
  }

  if (action === 'appExecutions.updateStatus') {
    const executionId = readString(payload?.executionId);
    const status = parseExecutionStatus(payload?.status);
    const hasErrorMessage = Object.prototype.hasOwnProperty.call(
      payload || {},
      'errorMessage'
    );
    const hasCompletedAt = Object.prototype.hasOwnProperty.call(
      payload || {},
      'completedAt'
    );
    const errorMessage =
      typeof payload?.errorMessage === 'string'
        ? payload.errorMessage
        : payload?.errorMessage === null
          ? null
          : undefined;
    const completedAt =
      typeof payload?.completedAt === 'string'
        ? payload.completedAt
        : payload?.completedAt === null
          ? null
          : undefined;

    if (!actorUserId) {
      return toErrorResponse('Unauthorized', 401);
    }
    if (!executionId || !status) {
      return toErrorResponse('Missing required fields', 400);
    }

    const owned = await loadExecutionOwnedByActor(executionId, actorUserId);
    if (!owned) {
      return toErrorResponse('Execution record not found', 404);
    }

    const updates: string[] = [
      'status = $1::execution_status',
      'updated_at = NOW()',
    ];
    const params: unknown[] = [status];
    let index = 2;

    if (hasErrorMessage) {
      updates.push(`error_message = $${index}`);
      params.push(errorMessage ?? null);
      index += 1;
    }

    if (hasCompletedAt) {
      updates.push(`completed_at = $${index}::timestamptz`);
      params.push(completedAt ?? null);
      index += 1;
    } else if (TERMINAL_EXECUTION_STATUSES.has(status)) {
      updates.push('completed_at = NOW()');
    }

    params.push(executionId);

    const rows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        UPDATE app_executions
        SET ${updates.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING id::text
      `,
      params
    );

    return toSuccessResponse(Boolean(rows[0]?.id));
  }

  if (action === 'appExecutions.updateComplete') {
    const executionId = readString(payload?.executionId);
    if (!actorUserId) {
      return toErrorResponse('Unauthorized', 401);
    }
    if (!executionId) {
      return toErrorResponse('Missing executionId', 400);
    }

    const completeData =
      payload?.completeData &&
      typeof payload.completeData === 'object' &&
      !Array.isArray(payload.completeData)
        ? (payload.completeData as Record<string, unknown>)
        : {};
    const status = parseExecutionStatus(completeData.status);
    if (!status) {
      return toErrorResponse('Invalid status', 400);
    }

    const owned = await loadExecutionOwnedByActor(executionId, actorUserId);
    if (!owned) {
      return toErrorResponse('Execution record not found', 404);
    }

    const updates: string[] = [
      'status = $1::execution_status',
      'updated_at = NOW()',
    ];
    const params: unknown[] = [status];
    let index = 2;

    const addSet = (sqlFragment: string, value: unknown) => {
      updates.push(`${sqlFragment} = $${index}`);
      params.push(value);
      index += 1;
    };

    const addSetWithCast = (
      sqlFragment: string,
      cast: string,
      value: unknown
    ) => {
      updates.push(`${sqlFragment} = $${index}::${cast}`);
      params.push(value);
      index += 1;
    };

    if (
      Object.prototype.hasOwnProperty.call(
        completeData,
        'external_execution_id'
      )
    ) {
      addSet(
        'external_execution_id',
        readString(completeData.external_execution_id) || null
      );
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'task_id')) {
      addSet('task_id', readString(completeData.task_id) || null);
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'outputs')) {
      const outputs =
        completeData.outputs &&
        typeof completeData.outputs === 'object' &&
        !Array.isArray(completeData.outputs)
          ? completeData.outputs
          : null;
      addSetWithCast('outputs', 'jsonb', JSON.stringify(outputs));
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'total_steps')) {
      const totalSteps =
        typeof completeData.total_steps === 'number' &&
        Number.isFinite(completeData.total_steps)
          ? Math.max(0, Math.floor(completeData.total_steps))
          : 0;
      addSet('total_steps', totalSteps);
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'total_tokens')) {
      const totalTokens =
        typeof completeData.total_tokens === 'number' &&
        Number.isFinite(completeData.total_tokens)
          ? Math.max(0, Math.floor(completeData.total_tokens))
          : 0;
      addSet('total_tokens', totalTokens);
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'elapsed_time')) {
      const elapsedTime =
        typeof completeData.elapsed_time === 'number' &&
        Number.isFinite(completeData.elapsed_time)
          ? completeData.elapsed_time
          : null;
      addSet('elapsed_time', elapsedTime);
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'error_message')) {
      addSet('error_message', readString(completeData.error_message) || null);
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'completed_at')) {
      addSetWithCast(
        'completed_at',
        'timestamptz',
        readString(completeData.completed_at) || null
      );
    }
    if (Object.prototype.hasOwnProperty.call(completeData, 'metadata')) {
      const metadata =
        completeData.metadata &&
        typeof completeData.metadata === 'object' &&
        !Array.isArray(completeData.metadata)
          ? completeData.metadata
          : {};
      addSetWithCast('metadata', 'jsonb', JSON.stringify(metadata));
    }

    params.push(executionId);

    const rows = await queryRowsWithPgSystemContext<AppExecutionRow>(
      `
        UPDATE app_executions
        SET ${updates.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING
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
      `,
      params
    );

    return toSuccessResponse(rows[0] ? sanitizeExecution(rows[0]) : null);
  }

  if (action === 'appExecutions.delete') {
    const executionId = readString(payload?.executionId);
    if (!actorUserId || !resolvedUserId || !executionId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const owned = await loadExecutionOwnedByActor(executionId, actorUserId);
    if (!owned) {
      return toErrorResponse('Execution record not found', 404);
    }

    const rows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        UPDATE app_executions
        SET status = 'deleted'::execution_status,
            updated_at = NOW()
        WHERE id = $1::uuid
          AND user_id = $2::uuid
          AND status <> 'deleted'::execution_status
        RETURNING id::text
      `,
      [executionId, resolvedUserId]
    );

    return toSuccessResponse(Boolean(rows[0]?.id));
  }

  return null;
}
