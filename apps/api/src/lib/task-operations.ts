import {
  toErrorResponse,
  toSuccessResponse,
} from '../routes/internal-data-route/helpers';
import type { ApiActionResponse } from '../routes/internal-data-route/types';
import { queryRowsWithPgSystemContext } from './pg-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATES = new Set([
  'registered',
  'admitted',
  'submitting',
  'accepted',
  'finished',
  'rejected',
  'reserved',
  'running',
  'success',
  'error',
  'interrupted',
  'waiting',
  'unknown',
]);

export async function listTaskOperations(
  payload: Record<string, unknown>,
  actorUserId: string
): Promise<ApiActionResponse> {
  for (const key of ['taskId', 'appId']) {
    if (
      payload[key] !== undefined &&
      (typeof payload[key] !== 'string' || !UUID.test(payload[key] as string))
    )
      return toErrorResponse(`Invalid ${key}`, 400);
  }
  if (payload.state !== undefined && !STATES.has(String(payload.state)))
    return toErrorResponse('Invalid state', 400);
  const page = Number(payload.page ?? 1);
  const size = Number(payload.limit ?? 25);
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 10000 ||
    !Number.isSafeInteger(size) ||
    size < 1 ||
    size > 100
  )
    return toErrorResponse('Invalid pagination', 400);
  const rows = await queryRowsWithPgSystemContext(
    `WITH tasks AS (
    SELECT s.root_task_id AS task_id, s.run_id, s.user_id AS owner_id, s.service_instance_id AS app_id,
      s.backend_type,s.state,s.quota_state,r.execution_status,r.persistence_status,
      r.run_kind,i.status AS interaction_status,s.created_at,s.updated_at,
      CASE WHEN r.id IS NOT NULL THEN r.execution_status IN ('reserved','submitting','running','unknown')
        ELSE s.backend_type='dify' AND s.state IN ('admitted','submitting','accepted','unknown') END AS occupies_slot,
      gap.used_count,gap.usage_quota,
      (SELECT count(*)::int FROM agent_submissions reserved WHERE reserved.quota_permission_id=s.quota_permission_id AND reserved.quota_state='reserved') AS reserved_count
    FROM agent_submissions s LEFT JOIN backend_runs r ON r.id=s.run_id
    LEFT JOIN backend_run_interactions i ON i.origin_run_id=r.id
    LEFT JOIN group_app_permissions gap ON gap.id=s.quota_permission_id
    UNION ALL
    SELECT COALESCE(root_submission.root_task_id,r.root_run_id),r.id,r.user_id,r.service_instance_id,b.backend_type,r.execution_status,
      'none',r.execution_status,r.persistence_status,r.run_kind,i.status,r.created_at,r.updated_at,
      r.execution_status IN ('reserved','submitting','running','unknown'),NULL::integer,NULL::integer,0
    FROM backend_runs r JOIN backend_conversations b ON b.conversation_id=r.conversation_id
    LEFT JOIN agent_submissions root_submission ON root_submission.run_id=r.root_run_id
    LEFT JOIN backend_run_interactions i ON i.origin_run_id=r.id
    WHERE NOT EXISTS (SELECT 1 FROM agent_submissions s WHERE s.run_id=r.id)
  ) SELECT tasks.*,
    CASE WHEN state='unknown' OR execution_status='unknown' THEN 'UPSTREAM_UNCONFIRMED'
      WHEN interaction_status='unknown' THEN 'UPSTREAM_UNCONFIRMED'
      WHEN interaction_status='submitting' THEN 'RESUME_IN_PROGRESS'
      WHEN execution_status='waiting' AND (interaction_status IS NULL OR interaction_status='pending') THEN 'WAITING_FOR_INPUT'
      WHEN persistence_status='failed' THEN 'SAVE_FAILED'
      WHEN persistence_status='pending' THEN 'SAVE_PENDING' ELSE NULL END AS blocking_reason
    FROM tasks WHERE EXISTS (SELECT 1 FROM profiles WHERE id=$1::uuid AND status='active' AND role='admin')
      AND ($2::uuid IS NULL OR task_id=$2::uuid OR run_id=$2::uuid)
      AND ($3::uuid IS NULL OR app_id=$3::uuid) AND ($4::text IS NULL OR state=$4 OR execution_status=$4)
    ORDER BY updated_at DESC,task_id DESC,run_id DESC NULLS LAST LIMIT $5 OFFSET $6`,
    [
      actorUserId,
      payload.taskId || null,
      payload.appId || null,
      payload.state || null,
      size,
      (page - 1) * size,
    ]
  );
  return toSuccessResponse({
    tasks: rows,
    page,
    limit: size,
    readOnly: true,
    quotaNote:
      'used_count is already counted; reserved_count is outstanding reservations for the same grant. No refund or automatic release is performed.',
  });
}
