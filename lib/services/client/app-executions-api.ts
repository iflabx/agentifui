import { callInternalDataAction } from '@lib/db/internal-data-api';
import type {
  AppExecution,
  ExecutionStatus,
  ExecutionType,
} from '@lib/types/database';
import type { Result } from '@lib/types/result';

type AppExecutionInput = Omit<AppExecution, 'id' | 'created_at' | 'updated_at'>;

type CompleteExecutionDataInput = {
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
};

export function createExecution(
  execution: AppExecutionInput
): Promise<Result<AppExecution>> {
  return callInternalDataAction<AppExecution>('appExecutions.create', {
    execution,
  });
}

export function updateExecutionStatus(
  executionId: string,
  status: ExecutionStatus,
  errorMessage?: string,
  completedAt?: string
): Promise<Result<boolean>> {
  return callInternalDataAction<boolean>('appExecutions.updateStatus', {
    executionId,
    status,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
    ...(completedAt !== undefined ? { completedAt } : {}),
  });
}

export function updateCompleteExecutionData(
  executionId: string,
  completeData: CompleteExecutionDataInput
): Promise<Result<AppExecution>> {
  return callInternalDataAction<AppExecution>('appExecutions.updateComplete', {
    executionId,
    completeData,
  });
}

export function getExecutionsByServiceInstance(
  serviceInstanceId: string,
  limit: number = 10
): Promise<Result<AppExecution[]>> {
  return callInternalDataAction<AppExecution[]>(
    'appExecutions.getByServiceInstance',
    {
      serviceInstanceId,
      limit,
    }
  );
}

export function getUserExecutions(
  limit: number = 20,
  executionType?: ExecutionType
): Promise<Result<AppExecution[]>> {
  return callInternalDataAction<AppExecution[]>(
    'appExecutions.getUserExecutions',
    {
      limit,
      ...(executionType ? { executionType } : {}),
    }
  );
}

export function getExecutionById(
  executionId: string
): Promise<Result<AppExecution | null>> {
  return callInternalDataAction<AppExecution | null>('appExecutions.getById', {
    executionId,
  });
}

export function deleteExecution(executionId: string): Promise<Result<boolean>> {
  return callInternalDataAction<boolean>('appExecutions.delete', {
    executionId,
  });
}
