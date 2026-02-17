/**
 * Database query functions related to app execution records.
 *
 * This file contains all database operations related to the app_executions table,
 * used to manage workflow and text generation app execution history.
 * Updated to use unified data service and Result type.
 */
import { cacheService } from '@lib/services/db/cache-service';
import { dataService } from '@lib/services/db/data-service';
import { Result, failure, success } from '@lib/types/result';

import {
  AppExecution,
  ExecutionStatus,
  ExecutionType,
} from '../types/database';

/**
 * Get a list of user execution records (optimized version)
 * @param userId User ID
 * @param limit Number per page, default 20
 * @param offset Offset, default 0
 * @param executionType Optional execution type filter
 * @param status Optional status filter
 * @returns Result containing execution records and total count
 */
export async function getUserExecutions(
  userId: string,
  limit: number = 20,
  offset: number = 0,
  executionType?: ExecutionType,
  status?: ExecutionStatus
): Promise<Result<{ executions: AppExecution[]; total: number }>> {
  const filters: Record<string, unknown> = {
    user_id: userId,
    ...(executionType && { execution_type: executionType }),
    ...(status && { status: status }),
  };

  try {
    // Get execution records
    const executionsResult = await dataService.findMany<AppExecution>(
      'app_executions',
      filters,
      { column: 'created_at', ascending: false },
      { offset, limit },
      {
        cache: true,
        cacheTTL: 2 * 60 * 1000, // 2 minutes cache
      }
    );

    if (!executionsResult.success) {
      return failure(executionsResult.error);
    }

    // Get total count
    const countResult = await dataService.count('app_executions', filters);

    if (!countResult.success) {
      return failure(countResult.error);
    }

    return success({
      executions: executionsResult.data,
      total: countResult.data,
    });
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Get execution record details by ID (optimized version, includes user permission check)
 * @param executionId Execution record ID
 * @param userId User ID - required, ensures only the user's record is returned
 * @returns Result of execution record object, or null if not found or unauthorized
 */
export async function getExecutionById(
  executionId: string,
  userId: string
): Promise<Result<AppExecution | null>> {
  return dataService.findOne<AppExecution>(
    'app_executions',
    {
      id: executionId,
      user_id: userId, // Security filter: only return records for the current user
    },
    {
      cache: true,
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache
    }
  );
}

/**
 * Get execution record by external execution ID (optimized version, includes user permission check)
 * @param externalExecutionId External execution ID (e.g., from Dify)
 * @param userId User ID - required, ensures only the user's record is returned
 * @returns Result of execution record object, or null if not found or unauthorized
 */
export async function getExecutionByExternalId(
  externalExecutionId: string,
  userId: string
): Promise<Result<AppExecution | null>> {
  return dataService.findOne<AppExecution>(
    'app_executions',
    {
      external_execution_id: externalExecutionId,
      user_id: userId, // Security filter: only return records for the current user
    },
    {
      cache: true,
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache
    }
  );
}

/**
 * Create a new execution record (optimized version)
 * @param execution Execution record object
 * @returns Result of created execution record object, or error if creation fails
 */
export async function createExecution(
  execution: Omit<AppExecution, 'id' | 'created_at' | 'updated_at'>
): Promise<Result<AppExecution>> {
  const executionWithDefaults = {
    ...execution,
    external_execution_id: execution.external_execution_id || null,
    task_id: execution.task_id || null,
    outputs: execution.outputs || null,
    error_message: execution.error_message || null,
    elapsed_time: execution.elapsed_time || null,
    completed_at: execution.completed_at || null,
    metadata: execution.metadata || {},
  };

  return dataService.create<AppExecution>(
    'app_executions',
    executionWithDefaults
  );
}

/**
 * Update an execution record (optimized version)
 * @param id Execution record ID
 * @param updates Fields to update
 * @returns Result of updated execution record object, or error if update fails
 */
export async function updateExecution(
  id: string,
  updates: Partial<Omit<AppExecution, 'id' | 'created_at' | 'updated_at'>>
): Promise<Result<AppExecution>> {
  const updateData = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  return dataService.update<AppExecution>('app_executions', id, updateData);
}

/**
 * Robust function for updating complete execution data.
 * Specifically used for saving complete data when workflow execution finishes.
 * @param id Execution record ID
 * @param completeData Complete execution data
 * @returns Result of updated execution record object
 */
export async function updateCompleteExecutionData(
  id: string,
  completeData: {
    status: ExecutionStatus;
    external_execution_id?: string | null;
    task_id?: string | null;
    outputs?: Record<string, unknown> | null;
    total_steps?: number;
    total_tokens?: number;
    elapsed_time?: number | null;
    error_message?: string | null;
    completed_at?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<Result<AppExecution>> {
  console.log('[DB] Start updating complete execution data, ID:', id);
  console.log('[DB] Update data:', JSON.stringify(completeData, null, 2));

  try {
    // Build a safe update data object, ensuring all fields have explicit values
    const safeUpdateData: Partial<AppExecution> = {
      status: completeData.status,
      updated_at: new Date().toISOString(),

      // Dify identifier - handle null values explicitly
      ...(completeData.external_execution_id !== undefined && {
        external_execution_id: completeData.external_execution_id,
      }),
      ...(completeData.task_id !== undefined && {
        task_id: completeData.task_id,
      }),

      // Execution results - handle null values explicitly
      ...(completeData.outputs !== undefined && {
        outputs: completeData.outputs,
      }),
      ...(completeData.total_steps !== undefined && {
        total_steps: completeData.total_steps,
      }),
      ...(completeData.total_tokens !== undefined && {
        total_tokens: completeData.total_tokens,
      }),
      ...(completeData.elapsed_time !== undefined && {
        elapsed_time: completeData.elapsed_time,
      }),

      // Error and completion info
      ...(completeData.error_message !== undefined && {
        error_message: completeData.error_message,
      }),
      ...(completeData.completed_at !== undefined && {
        completed_at: completeData.completed_at,
      }),

      // metadata - ensure it's a valid JSON object
      ...(completeData.metadata !== undefined && {
        metadata: completeData.metadata || {},
      }),
    };

    console.log(
      '[DB] Safe update data object:',
      JSON.stringify(safeUpdateData, null, 2)
    );

    const entries = Object.entries(safeUpdateData).filter(
      ([, value]) => value !== undefined
    );
    if (entries.length === 0) {
      return failure(new Error('No fields to update'));
    }

    const setClauses = entries.map(
      ([column], index) => `${column} = $${index + 1}`
    );
    const values = entries.map(([, value]) => value);
    values.push(id);

    const updateResult = await dataService.rawQuery<AppExecution>(
      `
        UPDATE app_executions
        SET ${setClauses.join(', ')}
        WHERE id = $${values.length}::uuid
        RETURNING *
      `,
      values
    );

    if (!updateResult.success) {
      console.error('[DB] Complete data update failed:', updateResult.error);
      return failure(updateResult.error);
    }

    const data = updateResult.data[0];
    if (!data) {
      console.error('[DB] Update succeeded but no data returned');
      return failure(new Error('Update succeeded but no data returned'));
    }

    console.log('[DB] ✅ Complete data update succeeded');
    console.log('[DB] Updated data:', JSON.stringify(data, null, 2));

    // Clear related cache
    try {
      await cacheService.delete(`execution:${id}`);
      await cacheService.delete(`executions:user:${data.user_id}`);
    } catch (cacheError) {
      console.warn('[DB] Error clearing cache:', cacheError);
    }

    return success(data as AppExecution);
  } catch (error) {
    console.error(
      '[DB] Exception occurred during complete data update:',
      error
    );
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Update execution status (optimized version)
 * @param id Execution record ID
 * @param status New status
 * @param errorMessage Optional error message
 * @param completedAt Optional completion time
 * @returns Result indicating whether the update was successful
 */
export async function updateExecutionStatus(
  id: string,
  status: ExecutionStatus,
  errorMessage?: string,
  completedAt?: string
): Promise<Result<boolean>> {
  const updateData: Partial<AppExecution> = {
    status,
    updated_at: new Date().toISOString(),
  };

  if (errorMessage !== undefined) {
    updateData.error_message = errorMessage;
  }

  if (completedAt !== undefined) {
    updateData.completed_at = completedAt;
  } else if (
    status === 'completed' ||
    status === 'failed' ||
    status === 'stopped'
  ) {
    updateData.completed_at = new Date().toISOString();
  }

  const result = await dataService.update<AppExecution>(
    'app_executions',
    id,
    updateData
  );

  if (result.success) {
    return success(true);
  } else {
    return success(false);
  }
}

/**
 * Delete execution record (soft delete version, includes user permission check)
 * @param id Execution record ID
 * @param userId User ID - required, ensures only the user's record can be deleted
 * @returns Result indicating whether the deletion was successful
 */
export async function deleteExecution(
  id: string,
  userId: string
): Promise<Result<boolean>> {
  console.log(
    `[Soft Delete Execution] Start soft deleting execution record, ID: ${id}, User ID: ${userId}`
  );

  // Security check: verify the record belongs to the current user
  const existingResult = await getExecutionById(id, userId);
  if (!existingResult.success || !existingResult.data) {
    console.warn(
      `[Soft Delete Execution] Record does not exist or unauthorized, ID: ${id}, User ID: ${userId}`
    );
    return failure(
      new Error(
        'Execution record does not exist or you are not authorized to delete it'
      )
    );
  }

  const result = await dataService.softDelete('app_executions', id);

  if (result.success) {
    console.log(`[Soft Delete Execution] Soft delete completed, ID: ${id}`);
    return success(true);
  } else {
    console.error(`[Soft Delete Execution] Soft delete failed:`, result.error);
    return success(false);
  }
}

/**
 * Get user execution records for a specific service instance (optimized version, filters out soft deleted records)
 * @param serviceInstanceId Service instance ID
 * @param userId User ID - required, ensures only the user's records are returned
 * @param limit Limit number of records
 * @returns Result containing list of execution records
 */
export async function getExecutionsByServiceInstance(
  serviceInstanceId: string,
  userId: string,
  limit: number = 10
): Promise<Result<AppExecution[]>> {
  try {
    console.log(
      '[Get Executions] Start query, Service Instance ID:',
      serviceInstanceId,
      'User ID:',
      userId
    );

    // Filter by service instance ID and user ID for security
    const result = await dataService.findMany<AppExecution>(
      'app_executions',
      {
        service_instance_id: serviceInstanceId,
        user_id: userId, // Security filter: only return records for the current user
      },
      { column: 'created_at', ascending: false },
      { offset: 0, limit: limit * 2 }, // Fetch more to ensure enough non-deleted records
      {
        cache: true,
        cacheTTL: 2 * 60 * 1000, // 2 minutes cache
      }
    );

    if (!result.success) {
      console.error(
        '[Get Executions] Data service query failed:',
        result.error
      );
      return failure(result.error);
    }

    // Filter out soft deleted records at the application layer
    const filteredData = result.data
      .filter(execution => execution.status !== 'deleted')
      .slice(0, limit); // Limit the final returned count

    console.log(
      '[Get Executions] Query succeeded, total:',
      result.data.length,
      'after filter:',
      filteredData.length
    );

    return success(filteredData);
  } catch (error) {
    console.error('[Get Executions] Exception occurred during query:', error);
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}

/**
 * Get user execution statistics
 * @param userId User ID
 * @param executionType Optional execution type filter
 * @returns Result containing statistics
 */
export async function getExecutionStats(
  userId: string,
  executionType?: ExecutionType
): Promise<
  Result<{
    total: number;
    completed: number;
    failed: number;
    running: number;
    totalTokens: number;
    avgElapsedTime: number;
  }>
> {
  try {
    const params: unknown[] = [userId];
    const whereClauses = ['user_id = $1::uuid'];
    if (executionType) {
      params.push(executionType);
      whereClauses.push(`execution_type = $${params.length}`);
    }

    const statsQuery = await dataService.rawQuery<{
      status: ExecutionStatus;
      total_tokens: number | null;
      elapsed_time: number | null;
    }>(
      `
        SELECT status, total_tokens, elapsed_time
        FROM app_executions
        WHERE ${whereClauses.join(' AND ')}
      `,
      params
    );

    if (!statsQuery.success) {
      return failure(statsQuery.error);
    }

    const data = statsQuery.data;
    const stats = {
      total: data.length,
      completed: data.filter(item => item.status === 'completed').length,
      failed: data.filter(item => item.status === 'failed').length,
      running: data.filter(
        item => item.status === 'running' || item.status === 'pending'
      ).length,
      totalTokens: data.reduce(
        (sum, item) => sum + (item.total_tokens || 0),
        0
      ),
      avgElapsedTime:
        data.length > 0
          ? data.reduce((sum, item) => sum + (item.elapsed_time || 0), 0) /
            data.length
          : 0,
    };

    return success(stats);
  } catch (error) {
    return failure(error instanceof Error ? error : new Error(String(error)));
  }
}
