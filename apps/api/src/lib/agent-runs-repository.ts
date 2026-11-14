import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';

import { AGENT_APP_VISIBILITY_SQL, agentConfigFingerprint } from './agent-app';
import { AgentPolicyError } from './agent-backends';
import { admitSubmission } from './agent-submissions';
import { runWithPgSystemContext } from './pg-context';

export type AgentExecutionStatus =
  | 'reserved'
  | 'submitting'
  | 'running'
  | 'success'
  | 'error'
  | 'interrupted'
  | 'unknown';

export interface AgentSavedMessage {
  id: string;
  content: string;
  tools?: unknown;
  order?: number;
}

export interface AgentRunResult {
  executionStatus: 'success' | 'error' | 'interrupted' | 'unknown';
  messages: AgentSavedMessage[];
  errorCode?: string;
}

export interface AgentRunRecord extends QueryResultRow {
  id: string;
  conversation_id: string;
  user_id: string;
  service_instance_id: string;
  submission_id: string;
  request_hash: string;
  user_message_id: string;
  native_run_id: string | null;
  execution_status: AgentExecutionStatus;
  persistence_status: 'pending' | 'saved' | 'failed';
  result: AgentRunResult | null;
  error_code: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  thread_id: string | null;
  backend_type: 'langchain';
  config_fingerprint: string;
  user_sequence_index: number;
}

export interface ReserveAgentRunInput {
  governanceTaskId?: string;
  userId: string;
  serviceInstanceId: string;
  appInstanceId: string;
  configFingerprint: string;
  submissionId: string;
  content: string;
  conversationId?: string;
  userLimit?: number;
  appLimit?: number;
}

export class AgentRunError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string
  ) {
    super(code);
    this.name = 'AgentRunError';
  }
}

const ACTIVE_STATUSES = ['reserved', 'submitting', 'running', 'unknown'];
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RUN_SELECT = `
  SELECT r.*, b.thread_id, b.backend_type, b.config_fingerprint,
    m.sequence_index AS user_sequence_index
  FROM backend_runs r
  JOIN backend_conversations b ON b.conversation_id = r.conversation_id
  JOIN conversations c ON c.id = r.conversation_id
  JOIN messages m ON m.id = r.user_message_id
`;

function uuid(value: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new AgentRunError(400, 'INVALID_AGENT_REQUEST');
  }
  return value.toLowerCase();
}

function safeCode(value: string | undefined): string | undefined {
  if (value !== undefined && !/^[A-Z][A-Z0-9_]{0,79}$/.test(value)) {
    throw new AgentRunError(400, 'INVALID_AGENT_ERROR_CODE');
  }
  return value;
}

async function storage<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AgentRunError || error instanceof AgentPolicyError)
      throw error;
    if ((error as { code?: string })?.code === '23505') {
      throw new AgentRunError(409, 'AGENT_RUN_CONFLICT');
    }
    throw new AgentRunError(503, 'AGENT_STORAGE_UNAVAILABLE');
  }
}

async function loadRun(
  client: PoolClient,
  runId: string,
  lock = false
): Promise<AgentRunRecord> {
  const { rows } = await client.query<AgentRunRecord>(
    `${RUN_SELECT} WHERE r.id = $1::uuid ${lock ? 'FOR UPDATE OF r' : ''}`,
    [runId]
  );
  if (!rows[0]) throw new AgentRunError(404, 'AGENT_RUN_NOT_FOUND');
  return rows[0];
}

async function requireActiveProfile(client: PoolClient, userId: string) {
  const { rows } = await client.query(
    `SELECT id FROM profiles WHERE id = $1::uuid AND status = 'active' FOR SHARE`,
    [userId]
  );
  if (!rows[0]) throw new AgentRunError(403, 'AGENT_ACCOUNT_INACTIVE');
}

async function requireLiveApplication(
  client: PoolClient,
  input: ReserveAgentRunInput
) {
  const { rows } = await client.query<{
    config: Record<string, unknown> | null;
    base_url: string;
  }>(
    `SELECT si.config, p.base_url
     FROM service_instances si
     JOIN providers p ON p.id = si.provider_id AND p.is_active = TRUE
     WHERE si.id = $1::uuid AND ${AGENT_APP_VISIBILITY_SQL}
       AND si.instance_id = $3
     FOR SHARE OF si, p`,
    [input.serviceInstanceId, input.userId, input.appInstanceId]
  );
  const app = rows[0];
  if (!app) throw new AgentRunError(404, 'AGENT_APP_NOT_FOUND');
  const langchain = app.config?.langchain as
    Record<string, unknown> | undefined;
  if (
    app.config?.backend_type !== 'langchain' ||
    typeof langchain?.assistant_id !== 'string'
  ) {
    throw new AgentRunError(409, 'AGENT_CONFIG_CHANGED');
  }
  let fingerprint: string;
  try {
    fingerprint = agentConfigFingerprint(
      input.serviceInstanceId,
      app.base_url,
      langchain.assistant_id
    );
  } catch {
    throw new AgentRunError(409, 'AGENT_CONFIG_CHANGED');
  }
  if (fingerprint !== input.configFingerprint) {
    throw new AgentRunError(409, 'AGENT_CONFIG_CHANGED');
  }
}

async function validateBinding(
  client: PoolClient,
  conversationId: string,
  input: ReserveAgentRunInput
) {
  const { rows } = await client.query(
    `SELECT b.conversation_id FROM backend_conversations b
     JOIN conversations c ON c.id = b.conversation_id
     WHERE b.conversation_id = $1::uuid AND c.user_id = $2::uuid
       AND c.status = 'active' AND b.service_instance_id = $3::uuid
       AND b.config_fingerprint = $4 AND b.backend_type = 'langchain'
     FOR UPDATE OF c, b`,
    [
      conversationId,
      input.userId,
      input.serviceInstanceId,
      input.configFingerprint,
    ]
  );
  if (!rows[0]) throw new AgentRunError(409, 'AGENT_CONVERSATION_UNAVAILABLE');
}

export async function reserveRun(
  input: ReserveAgentRunInput
): Promise<{ run: AgentRunRecord; replayed: boolean }> {
  const userId = uuid(input.userId);
  const serviceId = uuid(input.serviceInstanceId);
  const submissionId = uuid(input.submissionId);
  const conversationId = input.conversationId
    ? uuid(input.conversationId)
    : undefined;
  const userLimit = input.userLimit ?? 1;
  const appLimit = input.appLimit ?? 2;
  if (
    typeof input.content !== 'string' ||
    input.content.trim().length === 0 ||
    input.content.length > 16000 ||
    Buffer.byteLength(input.content, 'utf8') > 64000 ||
    !/^[0-9a-f]{64}$/i.test(input.configFingerprint) ||
    !Number.isSafeInteger(userLimit) ||
    userLimit < 1 ||
    !Number.isSafeInteger(appLimit) ||
    appLimit < 1
  ) {
    throw new AgentRunError(400, 'INVALID_AGENT_REQUEST');
  }
  const normalized = { ...input, userId, serviceInstanceId: serviceId };
  const requestHash = createHash('sha256').update(input.content).digest('hex');
  return storage(() =>
    runWithPgSystemContext(async client => {
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`agent-user:${userId}`]
      );
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
        [`agent-app:${serviceId}`]
      );
      await requireActiveProfile(client, userId);
      await requireLiveApplication(client, normalized);
      const replay = await client.query<AgentRunRecord>(
        `${RUN_SELECT} WHERE r.user_id = $1::uuid AND r.service_instance_id = $2::uuid
        AND r.submission_id = $3::uuid FOR UPDATE OF r`,
        [userId, serviceId, submissionId]
      );
      if (replay.rows[0]) {
        const run = replay.rows[0];
        if (
          run.request_hash !== requestHash ||
          (conversationId && conversationId !== run.conversation_id)
        ) {
          throw new AgentRunError(409, 'AGENT_SUBMISSION_MISMATCH');
        }
        await validateBinding(client, run.conversation_id, normalized);
        if (input.governanceTaskId) {
          await client.query(
            `UPDATE agent_submissions SET run_id = $2::uuid, state = $3, updated_at = NOW()
            WHERE root_task_id = $1::uuid AND backend_type = 'langchain' AND quota_state = 'none'
              AND user_id = $4::uuid AND service_instance_id = $5::uuid
              AND (run_id IS NULL OR run_id = $2::uuid) AND state IN ('registered','unknown')`,
            [
              input.governanceTaskId,
              run.id,
              ACTIVE_STATUSES.includes(run.execution_status)
                ? 'unknown'
                : 'finished',
              userId,
              serviceId,
            ]
          );
        }
        return { run, replayed: true };
      }
      if (conversationId) {
        await validateBinding(client, conversationId, normalized);
        const pending = await client.query(
          `SELECT id FROM backend_runs WHERE conversation_id = $1::uuid
          AND (execution_status = ANY($2::text[]) OR persistence_status <> 'saved') LIMIT 1`,
          [conversationId, ACTIVE_STATUSES]
        );
        if (pending.rows[0])
          throw new AgentRunError(409, 'AGENT_CONVERSATION_BUSY');
      }
      const counts = await client.query<{
        user_count: string;
        app_count: string;
      }>(
        `SELECT count(*) FILTER (WHERE user_id = $1::uuid)::text AS user_count,
        count(*) FILTER (WHERE service_instance_id = $2::uuid)::text AS app_count
       FROM backend_runs WHERE execution_status = ANY($3::text[])
         AND (user_id = $1::uuid OR service_instance_id = $2::uuid)`,
        [userId, serviceId, ACTIVE_STATUSES]
      );
      if (
        Number(counts.rows[0]?.user_count ?? 0) >= userLimit ||
        Number(counts.rows[0]?.app_count ?? 0) >= appLimit
      ) {
        throw new AgentRunError(429, 'AGENT_CONCURRENCY_LIMIT');
      }
      const allocatedId = conversationId ?? randomUUID();
      if (!conversationId) {
        await client.query(
          `INSERT INTO conversations (id, user_id, title, app_id, metadata)
         VALUES ($1::uuid, $2::uuid, $3, $4, '{"backend_type":"langchain"}'::jsonb)`,
          [allocatedId, userId, input.content.slice(0, 80), serviceId]
        );
        await client.query(
          `INSERT INTO backend_conversations (conversation_id, service_instance_id, config_fingerprint)
         VALUES ($1::uuid, $2::uuid, $3)`,
          [allocatedId, serviceId, input.configFingerprint]
        );
      }
      const messageId = randomUUID();
      const runId = randomUUID();
      if (input.governanceTaskId) {
        await admitSubmission(
          client,
          input.governanceTaskId,
          userId,
          serviceId,
          { userLimit, appLimit }
        );
      }
      await client.query(
        `INSERT INTO messages (id, conversation_id, user_id, role, content, metadata, sequence_index)
       SELECT $1::uuid, $2::uuid, $3::uuid, 'user', $4,
         jsonb_build_object('backend_type', 'langchain', 'backend_run_id', $5::text),
         COALESCE(MAX(sequence_index), -1) + 1 FROM messages WHERE conversation_id = $2::uuid`,
        [messageId, allocatedId, userId, input.content, runId]
      );
      await client.query(
        `INSERT INTO backend_runs (id, conversation_id, user_id, service_instance_id,
        submission_id, request_hash, user_message_id)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, $7::uuid)`,
        [
          runId,
          allocatedId,
          userId,
          serviceId,
          submissionId,
          requestHash,
          messageId,
        ]
      );
      if (input.governanceTaskId) {
        await client.query(
          `UPDATE agent_submissions SET run_id = $2::uuid WHERE root_task_id = $1::uuid`,
          [input.governanceTaskId, runId]
        );
      }
      return { run: await loadRun(client, runId), replayed: false };
    })
  );
}

export async function bindThread(
  runId: string,
  threadId: string
): Promise<AgentRunRecord> {
  const id = uuid(runId);
  if (
    typeof threadId !== 'string' ||
    !threadId.length ||
    threadId.length > 255
  ) {
    throw new AgentRunError(400, 'INVALID_AGENT_THREAD');
  }
  return storage(() =>
    runWithPgSystemContext(async client => {
      const run = await loadRun(client, id, true);
      if (
        !['reserved', 'submitting'].includes(run.execution_status) ||
        (run.thread_id !== null && run.thread_id !== threadId)
      ) {
        throw new AgentRunError(409, 'AGENT_BINDING_CONFLICT');
      }
      await client.query(
        `UPDATE backend_conversations SET thread_id = $2 WHERE conversation_id = $1::uuid`,
        [run.conversation_id, threadId]
      );
      await client.query(
        `UPDATE backend_runs SET execution_status = 'submitting', updated_at = NOW() WHERE id = $1::uuid`,
        [id]
      );
      return loadRun(client, id);
    })
  );
}

export async function recordNativeRun(
  runId: string,
  nativeRunId: string
): Promise<AgentRunRecord> {
  const id = uuid(runId);
  if (
    typeof nativeRunId !== 'string' ||
    !nativeRunId.length ||
    nativeRunId.length > 255
  ) {
    throw new AgentRunError(400, 'INVALID_AGENT_NATIVE_RUN');
  }
  return storage(() =>
    runWithPgSystemContext(async client => {
      const run = await loadRun(client, id, true);
      if (
        !run.thread_id ||
        !['submitting', 'running'].includes(run.execution_status) ||
        (run.native_run_id !== null && run.native_run_id !== nativeRunId)
      ) {
        throw new AgentRunError(409, 'AGENT_RUN_STATE_CONFLICT');
      }
      await client.query(
        `UPDATE backend_runs SET native_run_id = $2, execution_status = 'running',
        updated_at = NOW() WHERE id = $1::uuid`,
        [id, nativeRunId]
      );
      return loadRun(client, id);
    })
  );
}

function normalizeResult(result: AgentRunResult): AgentRunResult {
  if (
    !['success', 'error', 'interrupted', 'unknown'].includes(
      result.executionStatus
    ) ||
    !Array.isArray(result.messages) ||
    result.messages.length > 64
  ) {
    throw new AgentRunError(400, 'INVALID_AGENT_RESULT');
  }
  const ids = new Set<string>();
  const messages = result.messages.map(message => {
    const id = uuid(message.id);
    if (ids.has(id) || typeof message.content !== 'string') {
      throw new AgentRunError(400, 'INVALID_AGENT_RESULT');
    }
    ids.add(id);
    return {
      id,
      content: message.content,
      ...(Number.isSafeInteger(message.order) && message.order! >= 0
        ? { order: message.order }
        : {}),
      ...(message.tools === undefined ? {} : { tools: message.tools }),
    };
  });
  const errorCode = safeCode(result.errorCode);
  const normalized = {
    executionStatus: result.executionStatus,
    messages,
    ...(errorCode ? { errorCode } : {}),
  };
  try {
    const serialized = JSON.stringify(normalized);
    if (Buffer.byteLength(serialized, 'utf8') > 512000) throw new Error();
    return JSON.parse(serialized) as AgentRunResult;
  } catch {
    throw new AgentRunError(400, 'INVALID_AGENT_RESULT');
  }
}

export async function saveRunResult(
  runId: string,
  result: AgentRunResult
): Promise<AgentRunRecord> {
  const id = uuid(runId);
  const snapshot = normalizeResult(result);
  await storage(() =>
    runWithPgSystemContext(async client => {
      const run = await loadRun(client, id, true);
      if (run.result !== null) {
        const comparison = await client.query<{ matches: boolean }>(
          `SELECT result = $2::jsonb AS matches FROM backend_runs WHERE id = $1::uuid`,
          [id, JSON.stringify(snapshot)]
        );
        if (!comparison.rows[0]?.matches) {
          throw new AgentRunError(409, 'AGENT_RESULT_CONFLICT');
        }
        return;
      }
      if (
        snapshot.executionStatus === 'success' &&
        (!run.thread_id || !run.native_run_id)
      ) {
        throw new AgentRunError(409, 'AGENT_RUN_STATE_CONFLICT');
      }
      await client.query(
        `UPDATE backend_runs SET result = $2::jsonb, execution_status = $3,
        error_code = $4, persistence_status = 'pending', updated_at = NOW() WHERE id = $1::uuid`,
        [
          id,
          JSON.stringify(snapshot),
          snapshot.executionStatus,
          snapshot.errorCode ?? null,
        ]
      );
    })
  );
  try {
    return await storage(() =>
      runWithPgSystemContext(async client => {
        const run = await loadRun(client, id, true);
        if (run.persistence_status === 'saved') return run;
        if (!run.result) throw new AgentRunError(409, 'AGENT_RESULT_MISSING');
        for (const [index, message] of run.result.messages.entries()) {
          if (message.id === run.user_message_id)
            throw new AgentRunError(409, 'AGENT_MESSAGE_CONFLICT');
          const metadata = {
            backend_type: 'langchain',
            backend_run_id: id,
            ...(message.order === undefined
              ? {}
              : { projection_order: message.order }),
            ...(message.tools === undefined ? {} : { tools: message.tools }),
          };
          const inserted = await client.query(
            `INSERT INTO messages (id, conversation_id, user_id, role, content, metadata, status, sequence_index)
           VALUES ($1::uuid, $2::uuid, $3::uuid, 'assistant', $4, $5::jsonb, $6, $7)
           ON CONFLICT (id) DO NOTHING RETURNING id`,
            [
              message.id,
              run.conversation_id,
              run.user_id,
              message.content,
              JSON.stringify(metadata),
              run.execution_status === 'success' ? 'delivered' : 'error',
              run.user_sequence_index + index + 1,
            ]
          );
          if (!inserted.rows[0]) {
            const same = await client.query(
              `SELECT id FROM messages WHERE id = $1::uuid AND conversation_id = $2::uuid
              AND user_id = $3::uuid AND role = 'assistant' AND content = $4
              AND metadata = $5::jsonb AND sequence_index = $6`,
              [
                message.id,
                run.conversation_id,
                run.user_id,
                message.content,
                JSON.stringify(metadata),
                run.user_sequence_index + index + 1,
              ]
            );
            if (!same.rows[0])
              throw new AgentRunError(409, 'AGENT_MESSAGE_CONFLICT');
          }
        }
        const lastMessage = run.result.messages.at(-1)?.content;
        if (lastMessage !== undefined) {
          await client.query(
            `UPDATE conversations SET last_message_preview = $2, updated_at = NOW() WHERE id = $1::uuid`,
            [run.conversation_id, lastMessage.slice(0, 200)]
          );
        }
        await client.query(
          `UPDATE backend_runs SET persistence_status = 'saved', updated_at = NOW() WHERE id = $1::uuid`,
          [id]
        );
        return loadRun(client, id);
      })
    );
  } catch (error) {
    await runWithPgSystemContext(async client => {
      await client.query(
        `UPDATE backend_runs SET persistence_status = 'failed', updated_at = NOW()
          WHERE id = $1::uuid AND persistence_status <> 'saved'`,
        [id]
      );
    }).catch(() => undefined);
    throw error;
  }
}

export async function markRunUnknown(
  runId: string,
  errorCode = 'AGENT_RESULT_UNKNOWN'
): Promise<AgentRunRecord> {
  const id = uuid(runId);
  safeCode(errorCode);
  return storage(() =>
    runWithPgSystemContext(async client => {
      const run = await loadRun(client, id, true);
      if (!ACTIVE_STATUSES.includes(run.execution_status)) return run;
      await client.query(
        `UPDATE backend_runs SET execution_status = 'unknown', error_code = $2,
        updated_at = NOW() WHERE id = $1::uuid`,
        [id, errorCode]
      );
      return loadRun(client, id);
    })
  );
}

export async function recordRunPersistenceFailure(
  runId: string,
  result: AgentRunResult
): Promise<void> {
  const snapshot = normalizeResult(result);
  await storage(() =>
    runWithPgSystemContext(async client => {
      await client.query(
        `UPDATE backend_runs SET execution_status = $2, persistence_status = 'failed',
      result = COALESCE(result, $3::jsonb), updated_at = NOW() WHERE id = $1::uuid
      AND persistence_status <> 'saved' AND (result IS NULL OR result = $3::jsonb)
      AND (execution_status IN ('reserved','submitting','running','unknown') OR execution_status = $2)`,
        [uuid(runId), snapshot.executionStatus, JSON.stringify(snapshot)]
      );
    })
  );
}

export async function getRunForActor(
  runId: string,
  userId: string,
  serviceInstanceId: string
): Promise<AgentRunRecord | null> {
  const params = [uuid(runId), uuid(userId), uuid(serviceInstanceId)];
  return storage(() =>
    runWithPgSystemContext(async client => {
      const { rows } = await client.query<AgentRunRecord>(
        `${RUN_SELECT} JOIN profiles p ON p.id = r.user_id
       WHERE r.id = $1::uuid AND r.user_id = $2::uuid AND c.user_id = $2::uuid
         AND r.service_instance_id = $3::uuid AND c.status = 'active' AND p.status = 'active'`,
        params
      );
      return rows[0] ?? null;
    })
  );
}
