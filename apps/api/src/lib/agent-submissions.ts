import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';

import { AgentPolicyError, resolveBackendType } from './agent-backends';
import { runWithPgSystemContext } from './pg-context';

export const SUBMISSION_HEADER = 'x-agentifui-submission-id';
export const ROOT_TASK_HEADER = 'x-agentifui-root-task-id';

export interface AgentSubmission extends QueryResultRow {
  root_task_id: string;
  user_id: string;
  service_instance_id: string;
  submission_id: string;
  request_hash: string;
  target_fingerprint: string;
  backend_type: 'dify' | 'langchain';
  state:
    | 'registered'
    | 'admitted'
    | 'submitting'
    | 'accepted'
    | 'finished'
    | 'rejected'
    | 'unknown';
  quota_state: 'none' | 'exempt' | 'reserved' | 'counted' | 'released';
  quota_permission_id: string | null;
  run_id: string | null;
  error_code: string | null;
}

export interface SubmissionInput {
  userId: string;
  serviceInstanceId: string;
  submissionId: string;
  backendType: 'dify' | 'langchain';
  request: unknown;
  targetFingerprint: string;
}

export function submissionId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)
  ) {
    throw new AgentPolicyError(400, 'AGENT_SUBMISSION_ID_REQUIRED');
  }
  return value.toLowerCase();
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)])
    );
  }
  return value;
}

export function submissionHash(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export async function submissionStorage<Result>(
  operation: (client: PoolClient) => Promise<Result>
): Promise<Result> {
  try {
    return await runWithPgSystemContext(operation);
  } catch (error) {
    if (error instanceof AgentPolicyError) throw error;
    throw new AgentPolicyError(503, 'AGENT_GOVERNANCE_UNAVAILABLE');
  }
}

export async function registerSubmission(
  input: SubmissionInput
): Promise<{ task: AgentSubmission; replayed: boolean }> {
  const id = submissionId(input.submissionId);
  const hash = submissionHash(input.request);
  return submissionStorage(async client => {
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      [`agent-user:${input.userId}`]
    );
    await client.query(
      `UPDATE agent_submissions SET state = 'rejected', error_code = 'AGENT_SUBMISSION_EXPIRED', updated_at = NOW()
      WHERE user_id = $1::uuid AND state = 'registered' AND created_at < NOW() - INTERVAL '15 minutes'`,
      [input.userId]
    );
    const pending = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM agent_submissions
      WHERE user_id = $1::uuid AND state = 'registered' AND NOT EXISTS (
        SELECT 1 FROM agent_submissions prior WHERE prior.user_id = $1::uuid
          AND prior.service_instance_id = $2::uuid AND prior.submission_id = $3::uuid
      )`,
      [input.userId, input.serviceInstanceId, id]
    );
    if (Number(pending.rows[0]?.count ?? 0) >= 8)
      throw new AgentPolicyError(429, 'AGENT_REGISTRATION_LIMIT');
    const inserted = await client.query<AgentSubmission>(
      `INSERT INTO agent_submissions (root_task_id, user_id, service_instance_id, submission_id, request_hash, backend_type, target_fingerprint)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5, $6, $7)
       ON CONFLICT (user_id, service_instance_id, submission_id) DO NOTHING RETURNING *`,
      [
        randomUUID(),
        input.userId,
        input.serviceInstanceId,
        id,
        hash,
        input.backendType,
        input.targetFingerprint,
      ]
    );
    if (inserted.rows[0]) return { task: inserted.rows[0], replayed: false };
    const existing = await client.query<AgentSubmission>(
      `SELECT * FROM agent_submissions WHERE user_id = $1::uuid AND service_instance_id = $2::uuid AND submission_id = $3::uuid`,
      [input.userId, input.serviceInstanceId, id]
    );
    const task = existing.rows[0];
    if (
      !task ||
      task.request_hash !== hash ||
      task.backend_type !== input.backendType ||
      task.target_fingerprint !== input.targetFingerprint
    )
      throw new AgentPolicyError(409, 'AGENT_SUBMISSION_MISMATCH');
    return { task, replayed: true };
  });
}

export async function lockAdmission(
  client: PoolClient,
  userId: string,
  appId: string
): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `agent-user:${userId}`,
  ]);
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `agent-app:${appId}`,
  ]);
}

export async function admitSubmission(
  client: PoolClient,
  taskId: string,
  userId: string,
  appId: string,
  limits: { userLimit?: number; appLimit?: number },
  runId?: string
): Promise<void> {
  await lockAdmission(client, userId, appId);
  const { rows } = await client.query<AgentSubmission>(
    `SELECT * FROM agent_submissions WHERE root_task_id = $1::uuid AND user_id = $2::uuid AND service_instance_id = $3::uuid FOR UPDATE`,
    [taskId, userId, appId]
  );
  const task = rows[0];
  if (!task || task.state !== 'registered')
    throw new AgentPolicyError(
      409,
      task?.error_code ?? 'AGENT_SUBMISSION_IN_PROGRESS'
    );
  const appResult = await client.query<{
    visibility: string;
    role: string;
    config: Record<string, unknown> | null;
    base_url: string;
    instance_id: string;
  }>(
    `SELECT si.visibility, si.config, si.instance_id, p.base_url, actor.role FROM service_instances si
     JOIN providers p ON p.id = si.provider_id AND p.is_active = TRUE
     JOIN profiles actor ON actor.id = $2::uuid AND actor.status = 'active'
     WHERE si.id = $1::uuid AND (actor.role = 'admin' OR si.visibility = 'public' OR
       (si.visibility = 'group_only' AND EXISTS (SELECT 1 FROM group_app_permissions gap
        JOIN group_members gm ON gm.group_id = gap.group_id WHERE gap.service_instance_id = si.id
        AND gap.is_enabled = TRUE AND gm.user_id = actor.id))) FOR SHARE OF si, p, actor`,
    [appId, userId]
  );
  const app = appResult.rows[0];
  if (!app) throw new AgentPolicyError(403, 'AGENT_APP_FORBIDDEN');
  if (resolveBackendType(app.config) !== task.backend_type)
    throw new AgentPolicyError(409, 'AGENT_BACKEND_MISMATCH');
  const assistant = app.config?.langchain as
    Record<string, unknown> | undefined;
  const target = submissionHash([
    appId,
    new URL(app.base_url).toString().replace(/\/+$/, ''),
    task.backend_type === 'langchain'
      ? assistant?.assistant_id
      : app.instance_id,
  ]);
  if (target !== task.target_fingerprint)
    throw new AgentPolicyError(409, 'AGENT_CONFIG_CHANGED');
  const counts = await client.query<{ user_count: string; app_count: string }>(
    `SELECT count(*) FILTER (WHERE user_id = $1::uuid)::text AS user_count,
       count(*) FILTER (WHERE service_instance_id = $2::uuid)::text AS app_count
     FROM (
       SELECT user_id, service_instance_id FROM backend_runs WHERE execution_status IN ('reserved','submitting','running','unknown')
       UNION ALL SELECT user_id, service_instance_id FROM agent_submissions WHERE backend_type = 'dify'
         AND state IN ('admitted','submitting','accepted','unknown')
     ) active WHERE user_id = $1::uuid OR service_instance_id = $2::uuid`,
    [userId, appId]
  );
  if (
    Number(counts.rows[0]?.user_count ?? 0) >= (limits.userLimit ?? 1) ||
    Number(counts.rows[0]?.app_count ?? 0) >= (limits.appLimit ?? 2)
  )
    throw new AgentPolicyError(429, 'AGENT_CONCURRENCY_LIMIT');
  let permissionId: string | null = null;
  if (app.visibility === 'group_only') {
    const permission = await client.query<{
      id: string;
      usage_quota: number | null;
      used_count: number;
    }>(
      `SELECT gap.id, gap.usage_quota, gap.used_count FROM group_app_permissions gap
       JOIN group_members gm ON gm.group_id = gap.group_id
       WHERE gap.service_instance_id = $1::uuid AND gm.user_id = $2::uuid AND gap.is_enabled = TRUE
       ORDER BY gap.created_at ASC, gap.id ASC LIMIT 1 FOR UPDATE OF gap`,
      [appId, userId]
    );
    const selected = permission.rows[0];
    if (!selected)
      throw new AgentPolicyError(403, 'AGENT_GROUP_PERMISSION_REQUIRED');
    const reserved = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM agent_submissions WHERE quota_permission_id = $1::uuid AND quota_state = 'reserved'`,
      [selected.id]
    );
    if (
      selected.usage_quota !== null &&
      Number(selected.used_count) + Number(reserved.rows[0]?.count ?? 0) >=
        selected.usage_quota
    )
      throw new AgentPolicyError(429, 'AGENT_QUOTA_EXCEEDED');
    permissionId = selected.id;
  }
  await client.query(
    `UPDATE agent_submissions SET state = 'admitted', quota_permission_id = $2::uuid,
    quota_state = $3, run_id = $4::uuid, updated_at = NOW() WHERE root_task_id = $1::uuid`,
    [taskId, permissionId, permissionId ? 'reserved' : 'exempt', runId ?? null]
  );
}

export async function rejectSubmission(
  taskId: string,
  code: string
): Promise<void> {
  await submissionStorage(async client => {
    await client.query(
      `UPDATE agent_submissions SET state = 'rejected', quota_state = CASE WHEN quota_state = 'reserved' THEN 'released' ELSE quota_state END,
      error_code = $2, updated_at = NOW() WHERE root_task_id = $1::uuid AND state IN ('registered','admitted')`,
      [taskId, code]
    );
  });
}

export async function markSubmissionSubmitting(taskId: string): Promise<void> {
  await submissionStorage(async client => {
    const result = await client.query(
      `UPDATE agent_submissions SET state = 'submitting', updated_at = NOW() WHERE root_task_id = $1::uuid AND state = 'admitted' RETURNING root_task_id`,
      [taskId]
    );
    if (!result.rows[0])
      throw new AgentPolicyError(409, 'AGENT_SUBMISSION_IN_PROGRESS');
  });
}

export async function rejectUnacceptedSubmission(
  taskId: string
): Promise<void> {
  await submissionStorage(async client => {
    await client.query(
      `UPDATE agent_submissions SET state = 'rejected', error_code = 'AGENT_NATIVE_REJECTED',
      quota_state = CASE WHEN quota_state = 'reserved' THEN 'released' ELSE quota_state END, updated_at = NOW()
      WHERE root_task_id = $1::uuid AND state = 'submitting' AND quota_state IN ('reserved','exempt')`,
      [taskId]
    );
  });
}

export async function confirmSubmission(
  taskId: string,
  outcome: 'accepted' | 'finished' | 'unknown'
): Promise<void> {
  await submissionStorage(async client => {
    const { rows } = await client.query<AgentSubmission>(
      `SELECT * FROM agent_submissions WHERE root_task_id = $1::uuid FOR UPDATE`,
      [taskId]
    );
    const task = rows[0];
    if (!task || ['registered', 'rejected', 'finished'].includes(task.state))
      return;
    if (outcome !== 'unknown' && task.quota_state === 'reserved') {
      const updated = await client.query(
        `UPDATE group_app_permissions SET used_count = COALESCE(used_count, 0) + 1 WHERE id = $1::uuid RETURNING id`,
        [task.quota_permission_id]
      );
      if (!updated.rows[0])
        throw new AgentPolicyError(503, 'AGENT_QUOTA_CONFIRMATION_FAILED');
    }
    await client.query(
      `UPDATE agent_submissions SET state = $2, quota_state = CASE WHEN $2 <> 'unknown' AND quota_state = 'reserved' THEN 'counted' ELSE quota_state END,
      updated_at = NOW() WHERE root_task_id = $1::uuid`,
      [
        taskId,
        outcome === 'unknown' && task.state === 'accepted'
          ? 'unknown'
          : outcome,
      ]
    );
  });
}

export async function getSubmissionForActor(
  userId: string,
  appId: string,
  id: string
) {
  return submissionStorage(async client => {
    const { rows } = await client.query<AgentSubmission>(
      `SELECT task.* FROM agent_submissions task
       JOIN profiles actor ON actor.id = task.user_id AND actor.status = 'active'
       JOIN service_instances si ON si.id = task.service_instance_id
       WHERE task.user_id = $1::uuid AND task.service_instance_id = $2::uuid AND task.submission_id = $3::uuid
       AND (actor.role = 'admin' OR si.visibility = 'public' OR (si.visibility = 'group_only' AND EXISTS (
         SELECT 1 FROM group_app_permissions gap JOIN group_members gm ON gm.group_id = gap.group_id
         WHERE gap.service_instance_id = si.id AND gap.is_enabled = TRUE AND gm.user_id = actor.id)))`,
      [userId, submissionId(appId), submissionId(id)]
    );
    const task = rows[0];
    if (!task) throw new AgentPolicyError(404, 'AGENT_SUBMISSION_NOT_FOUND');
    return {
      rootTaskId: task.root_task_id,
      state: task.state,
      quotaState: task.quota_state,
      runId: task.run_id,
      ...(task.error_code ? { errorCode: task.error_code } : {}),
    };
  });
}
