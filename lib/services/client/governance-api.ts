import { callInternalDataAction } from '@lib/db/internal-data-api';

export interface GovernanceCursor {
  createdAt: string;
  id: string;
}
export interface ManagementAuditEvent {
  id: string;
  operation_id: string;
  request_id: string;
  actor_kind: 'user' | 'maintenance';
  actor_user_id: string | null;
  action: string;
  target_type: string;
  target_id: string | null;
  outcome: 'committed' | 'failed' | 'denied';
  changes: Record<string, unknown>;
  reason_code: string | null;
  created_at: string;
}
export interface TaskOperation {
  task_id: string;
  run_id: string | null;
  owner_id: string;
  app_id: string;
  backend_type: string;
  state: string;
  quota_state: string;
  execution_status: string | null;
  persistence_status: string | null;
  interaction_status: string | null;
  occupies_slot: boolean;
  used_count: number | null;
  usage_quota: number | null;
  reserved_count: number;
  blocking_reason: string | null;
  created_at: string;
  updated_at: string;
}

export function getManagementAudit(
  payload: {
    operationId?: string;
    action?: string;
    limit?: number;
    cursor?: GovernanceCursor;
  } = {}
) {
  return callInternalDataAction<ManagementAuditEvent[]>(
    'audit.getRecent',
    payload
  );
}

export function getTaskOperations(
  payload: {
    taskId?: string;
    appId?: string;
    state?: string;
    page?: number;
    limit?: number;
  } = {}
) {
  return callInternalDataAction<{
    tasks: TaskOperation[];
    page: number;
    limit: number;
    readOnly: true;
    quotaNote: string;
  }>('tasks.getRecent', payload);
}
