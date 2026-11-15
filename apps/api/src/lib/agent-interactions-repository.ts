import {
  AGUI_PROTOCOL_VERSION,
  AgentEventProjection,
  EventType,
} from '@agentifui/shared';
import { randomUUID } from 'node:crypto';
import type { PoolClient, QueryResultRow } from 'pg';

import { AGENT_APP_VISIBILITY_SQL, type AgentApp } from './agent-app';
import { AgentPolicyError } from './agent-backends';
import {
  AgentRunError,
  type AgentRunRecord,
  loadRun,
} from './agent-runs-repository';
import {
  admitResume,
  lockAdmission,
  requireResumeAuthorization,
  submissionHash,
  submissionId,
} from './agent-submissions';
import type {
  HumanInputDecision,
  HumanInputPrompt,
  NativeHumanInputState,
} from './langchain/human-input';
import { runWithPgSystemContext } from './pg-context';

export interface AgentInteractionRecord extends QueryResultRow {
  id: string;
  origin_run_id: string;
  native_interrupt_id: string;
  checkpoint: Record<string, unknown>;
  prompt: HumanInputPrompt;
  expires_at: Date | string | null;
  status: 'pending' | 'submitting' | 'accepted' | 'expired' | 'unknown';
  submission_id: string | null;
  request_hash: string | null;
  decision: HumanInputDecision | null;
  resume_run_id: string | null;
}

async function storage<Result>(operation: () => Promise<Result>) {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof AgentRunError || error instanceof AgentPolicyError)
      throw error;
    if ((error as { code?: string })?.code === '23505')
      throw new AgentRunError(409, 'AGENT_INTERACTION_CONFLICT');
    throw new AgentRunError(503, 'AGENT_STORAGE_UNAVAILABLE');
  }
}

export function publicAgentInteraction(interaction: AgentInteractionRecord) {
  return {
    id: interaction.id,
    originRunId: interaction.origin_run_id,
    status: interaction.status,
    title: interaction.prompt.title,
    description: interaction.prompt.description,
    actions: interaction.prompt.actions,
    commentMaxLength: interaction.prompt.commentMaxLength,
    expiresAt:
      interaction.expires_at === null
        ? null
        : new Date(interaction.expires_at).toISOString(),
    ...(interaction.decision
      ? {
          decision: {
            action: interaction.decision.action,
            comment: interaction.decision.comment,
          },
        }
      : {}),
    ...(interaction.resume_run_id
      ? { resumeRunId: interaction.resume_run_id }
      : {}),
  };
}

export function validateInteractionDecision(
  value: unknown,
  prompt: HumanInputPrompt
): HumanInputDecision & { submissionId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AgentRunError(400, 'INVALID_AGENT_RESPONSE');
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).some(
      key => !['submissionId', 'action', 'comment'].includes(key)
    ) ||
    (body.action !== 'approve' && body.action !== 'reject') ||
    !prompt.actions.includes(body.action) ||
    (body.comment !== undefined && typeof body.comment !== 'string')
  )
    throw new AgentRunError(400, 'INVALID_AGENT_RESPONSE');
  const comment = body.comment === undefined ? '' : (body.comment as string);
  if (
    [...comment].length > prompt.commentMaxLength ||
    Buffer.byteLength(comment, 'utf8') > 2000
  )
    throw new AgentRunError(400, 'INVALID_AGENT_RESPONSE');
  return {
    submissionId: submissionId(body.submissionId),
    action: body.action,
    comment,
  };
}

const INTERACTION_SELECT = `SELECT interaction.* FROM backend_run_interactions interaction
  JOIN backend_runs origin ON origin.id = interaction.origin_run_id
  JOIN backend_conversations binding ON binding.conversation_id = origin.conversation_id
  JOIN conversations conversation ON conversation.id = origin.conversation_id
  JOIN service_instances si ON si.id = origin.service_instance_id
  WHERE origin.user_id = $2::uuid AND conversation.user_id = $2::uuid AND conversation.status = 'active'
    AND origin.service_instance_id = $1::uuid AND binding.config_fingerprint = $3
    AND binding.backend_type = 'langchain' AND binding.human_input = TRUE AND ${AGENT_APP_VISIBILITY_SQL}`;

export async function listInteractions(
  app: AgentApp,
  userId: string,
  conversationId: string
): Promise<AgentInteractionRecord[]> {
  return storage(() =>
    runWithPgSystemContext(async client => {
      const owned = await client.query(
        `SELECT conversation.id FROM conversations conversation
      JOIN backend_conversations binding ON binding.conversation_id = conversation.id
      WHERE conversation.id = $1::uuid AND conversation.user_id = $2::uuid AND conversation.status = 'active'
        AND binding.service_instance_id = $3::uuid AND binding.config_fingerprint = $4`,
        [submissionId(conversationId), userId, app.id, app.fingerprint]
      );
      if (!owned.rows[0])
        throw new AgentRunError(404, 'AGENT_CONVERSATION_NOT_FOUND');
      const { rows } = await client.query<AgentInteractionRecord>(
        `${INTERACTION_SELECT}
      AND origin.conversation_id = $4::uuid ORDER BY interaction.created_at, interaction.id`,
        [app.id, userId, app.fingerprint, conversationId]
      );
      return rows;
    })
  );
}

export async function getInteractionForActor(
  app: AgentApp,
  userId: string,
  id: string
): Promise<AgentInteractionRecord> {
  return storage(() =>
    runWithPgSystemContext(async client => {
      const { rows } = await client.query<AgentInteractionRecord>(
        `${INTERACTION_SELECT} AND interaction.id = $4::uuid`,
        [app.id, userId, app.fingerprint, submissionId(id)]
      );
      if (!rows[0]) throw new AgentRunError(404, 'AGENT_INTERACTION_NOT_FOUND');
      return rows[0];
    })
  );
}

export async function recordInteraction(
  run: AgentRunRecord,
  interrupt: NonNullable<NativeHumanInputState['interrupt']>
): Promise<AgentInteractionRecord> {
  return storage(() =>
    runWithPgSystemContext(async client => {
      await loadRun(client, run.id, true);
      const existing = await client.query<AgentInteractionRecord>(
        'SELECT * FROM backend_run_interactions WHERE origin_run_id = $1::uuid',
        [run.id]
      );
      if (existing.rows[0]) {
        if (existing.rows[0].native_interrupt_id !== interrupt.id)
          throw new AgentRunError(409, 'AGENT_INTERRUPT_CHANGED');
        return existing.rows[0];
      }
      const { rows } = await client.query<AgentInteractionRecord>(
        `INSERT INTO backend_run_interactions
      (origin_run_id, native_interrupt_id, checkpoint, prompt, expires_at)
      VALUES ($1::uuid, $2, $3::jsonb, $4::jsonb, $5::timestamptz) RETURNING *`,
        [
          run.id,
          interrupt.id,
          JSON.stringify(interrupt.checkpoint),
          JSON.stringify(interrupt.prompt),
          interrupt.prompt.expiresAt,
        ]
      );
      return rows[0];
    })
  );
}

async function findResponseAttempt(
  client: PoolClient,
  app: AgentApp,
  userId: string,
  interaction: AgentInteractionRecord,
  response: HumanInputDecision & { submissionId: string }
): Promise<AgentRunRecord | null> {
  const previous = await client.query<{ id: string }>(
    `SELECT id FROM backend_runs WHERE user_id = $1::uuid AND service_instance_id = $2::uuid
      AND submission_id = $3::uuid`,
    [userId, app.id, response.submissionId]
  );
  if (!previous.rows[0]) return null;
  const run = await loadRun(client, previous.rows[0].id);
  const origin = await loadRun(client, interaction.origin_run_id);
  if (
    run.run_kind !== 'resume' ||
    run.root_run_id !== origin.id ||
    run.conversation_id !== origin.conversation_id ||
    run.request_hash !==
      submissionHash({
        action: response.action,
        comment: response.comment,
        interactionId: interaction.id,
      })
  )
    throw new AgentRunError(409, 'AGENT_SUBMISSION_MISMATCH');
  return run;
}

export async function getInteractionResponseReplay(input: {
  app: AgentApp;
  userId: string;
  interactionId: string;
  response: HumanInputDecision & { submissionId: string };
}): Promise<AgentRunRecord | null> {
  return storage(() =>
    runWithPgSystemContext(async client => {
      const { rows } = await client.query<AgentInteractionRecord>(
        `${INTERACTION_SELECT} AND interaction.id = $4::uuid`,
        [input.app.id, input.userId, input.app.fingerprint, input.interactionId]
      );
      if (!rows[0]) throw new AgentRunError(404, 'AGENT_INTERACTION_NOT_FOUND');
      return findResponseAttempt(
        client,
        input.app,
        input.userId,
        rows[0],
        validateInteractionDecision(input.response, rows[0].prompt)
      );
    })
  );
}

export async function reserveInteractionResponse(input: {
  app: AgentApp;
  userId: string;
  interactionId: string;
  response: HumanInputDecision & { submissionId: string };
  userLimit?: number;
  appLimit?: number;
}): Promise<{
  run: AgentRunRecord;
  replayed: boolean;
  interaction: AgentInteractionRecord;
}> {
  return storage(() =>
    runWithPgSystemContext(async client => {
      await lockAdmission(client, input.userId, input.app.id);
      const { rows } = await client.query<AgentInteractionRecord>(
        `${INTERACTION_SELECT}
      AND interaction.id = $4::uuid FOR UPDATE OF interaction`,
        [
          input.app.id,
          input.userId,
          input.app.fingerprint,
          submissionId(input.interactionId),
        ]
      );
      const interaction = rows[0];
      if (!interaction)
        throw new AgentRunError(404, 'AGENT_INTERACTION_NOT_FOUND');
      const decision = validateInteractionDecision(
        input.response,
        interaction.prompt
      );
      const hash = submissionHash({
        action: decision.action,
        comment: decision.comment,
        interactionId: interaction.id,
      });
      const previous = await findResponseAttempt(
        client,
        input.app,
        input.userId,
        interaction,
        decision
      );
      if (previous) return { run: previous, replayed: true, interaction };
      if (interaction.submission_id) {
        if (
          interaction.submission_id !== decision.submissionId ||
          interaction.request_hash !== hash ||
          !interaction.resume_run_id
        )
          throw new AgentRunError(409, 'AGENT_INTERACTION_ALREADY_RESPONDED');
        return {
          run: await loadRun(client, interaction.resume_run_id),
          replayed: true,
          interaction,
        };
      }
      if (
        interaction.status !== 'pending' ||
        (interaction.expires_at &&
          new Date(interaction.expires_at).getTime() <= Date.now())
      )
        throw new AgentRunError(409, 'AGENT_INTERACTION_EXPIRED');
      const origin = await loadRun(client, interaction.origin_run_id, true);
      if (
        origin.execution_status !== 'waiting' ||
        origin.persistence_status !== 'saved' ||
        !origin.thread_id
      )
        throw new AgentRunError(409, 'AGENT_INTERACTION_NOT_READY');
      await client.query(
        'SELECT id FROM conversations WHERE id = $1::uuid FOR UPDATE',
        [origin.conversation_id]
      );
      const app = await client.query(
        `SELECT si.id FROM service_instances si JOIN providers provider ON provider.id = si.provider_id
      WHERE si.id = $1::uuid AND provider.is_active = TRUE AND si.config->'langchain'->'human_input' = 'true'::jsonb FOR SHARE OF si, provider`,
        [input.app.id]
      );
      if (!app.rows[0])
        throw new AgentRunError(409, 'AGENT_INTERACTION_NOT_ENABLED');
      await admitResume(
        client,
        origin.root_run_id ?? origin.id,
        input.userId,
        input.app.id,
        input
      );
      const runId = randomUUID();
      const anchor = await client.query<{ sequence: number }>(
        'SELECT COALESCE(MAX(sequence_index), -1) AS sequence FROM messages WHERE conversation_id = $1::uuid',
        [origin.conversation_id]
      );
      await client.query(
        `INSERT INTO backend_runs (id, conversation_id, user_id, service_instance_id,
      submission_id, request_hash, user_message_id, run_kind, root_run_id, sequence_anchor, execution_status)
      VALUES ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, NULL, 'resume', $7::uuid, $8, 'reserved')`,
        [
          runId,
          origin.conversation_id,
          input.userId,
          input.app.id,
          decision.submissionId,
          hash,
          origin.root_run_id ?? origin.id,
          anchor.rows[0].sequence,
        ]
      );
      const updated = await client.query<AgentInteractionRecord>(
        `UPDATE backend_run_interactions SET status = 'submitting',
      submission_id = $2::uuid, request_hash = $3, decision = $4::jsonb, resume_run_id = $5::uuid, updated_at = NOW()
      WHERE id = $1::uuid AND status = 'pending' RETURNING *`,
        [
          interaction.id,
          decision.submissionId,
          hash,
          JSON.stringify({
            action: decision.action,
            comment: decision.comment,
          }),
          runId,
        ]
      );
      if (!updated.rows[0])
        throw new AgentRunError(409, 'AGENT_INTERACTION_CONFLICT');
      return {
        run: await loadRun(client, runId),
        replayed: false,
        interaction: updated.rows[0],
      };
    })
  );
}

export async function markResumeSubmitting(input: {
  app: AgentApp;
  run: AgentRunRecord;
  interaction: AgentInteractionRecord;
}): Promise<void> {
  await storage(() =>
    runWithPgSystemContext(async client => {
      await lockAdmission(client, input.run.user_id, input.app.id);
      const { rows } = await client.query<AgentInteractionRecord>(
        `${INTERACTION_SELECT} AND interaction.id = $4::uuid FOR UPDATE OF interaction`,
        [
          input.app.id,
          input.run.user_id,
          input.app.fingerprint,
          input.interaction.id,
        ]
      );
      const interaction = rows[0];
      const run = await loadRun(client, input.run.id, true);
      if (
        !interaction ||
        interaction.status !== 'submitting' ||
        interaction.resume_run_id !== run.id ||
        interaction.submission_id !== run.submission_id ||
        interaction.request_hash !== run.request_hash ||
        run.run_kind !== 'resume' ||
        run.execution_status !== 'reserved' ||
        run.persistence_status !== 'pending' ||
        run.native_run_id ||
        run.result
      )
        throw new AgentRunError(409, 'AGENT_RESUME_NOT_DISPATCHED');
      await requireResumeAuthorization(
        client,
        run.root_run_id!,
        run.user_id,
        input.app.id
      );
      const changed = await client.query(
        `UPDATE backend_runs SET execution_status = 'submitting', updated_at = NOW()
       WHERE id = $1::uuid AND execution_status = 'reserved' AND persistence_status = 'pending' AND native_run_id IS NULL AND result IS NULL
         AND EXISTS (SELECT 1 FROM backend_run_interactions WHERE id = $2::uuid
           AND status = 'submitting' AND resume_run_id = $1::uuid
           AND (expires_at IS NULL OR expires_at > clock_timestamp())) RETURNING id`,
        [run.id, interaction.id]
      );
      if (!changed.rows[0])
        throw new AgentRunError(409, 'AGENT_RESUME_NOT_DISPATCHED');
    })
  );
}

export async function releaseUndispatchedResume(
  runId: string
): Promise<boolean> {
  return storage(() =>
    runWithPgSystemContext(async client => {
      const initial = await loadRun(client, runId);
      if (initial.run_kind !== 'resume') return false;
      await lockAdmission(client, initial.user_id, initial.service_instance_id);
      const { rows } = await client.query<AgentInteractionRecord>(
        `SELECT * FROM backend_run_interactions WHERE resume_run_id = $1::uuid FOR UPDATE`,
        [runId]
      );
      const interaction = rows[0];
      const run = await loadRun(client, runId, true);
      if (
        !interaction ||
        interaction.status !== 'submitting' ||
        interaction.submission_id !== run.submission_id ||
        interaction.request_hash !== run.request_hash ||
        run.execution_status !== 'reserved' ||
        run.persistence_status !== 'pending' ||
        run.native_run_id ||
        run.result
      )
        return false;
      await client.query(
        `UPDATE backend_run_interactions SET status = CASE WHEN expires_at <= clock_timestamp() THEN 'expired' ELSE 'pending' END,
        submission_id = NULL, request_hash = NULL, decision = NULL, resume_run_id = NULL, updated_at = NOW()
       WHERE id = $1::uuid AND resume_run_id = $2::uuid AND status = 'submitting'`,
        [interaction.id, runId]
      );
      const projection = new AgentEventProjection({
        threadId: run.conversation_id,
        runId: run.id,
        history: [],
      });
      projection.accept({
        type: EventType.RUN_STARTED,
        protocolVersion: AGUI_PROTOCOL_VERSION,
        threadId: run.conversation_id,
        runId: run.id,
      });
      projection.accept({
        type: EventType.RUN_ERROR,
        code: 'AGENT_RESUME_NOT_DISPATCHED',
        message: 'Resume was not dispatched. Submit a new response to retry.',
      });
      await client.query(
        `UPDATE backend_runs SET execution_status = 'error', persistence_status = 'saved',
        error_code = 'AGENT_RESUME_NOT_DISPATCHED', result = $2::jsonb, updated_at = NOW() WHERE id = $1::uuid`,
        [
          runId,
          JSON.stringify({
            executionStatus: 'error',
            messages: [],
            errorCode: 'AGENT_RESUME_NOT_DISPATCHED',
            agui: projection.snapshot(),
          }),
        ]
      );
      return true;
    })
  );
}

export async function updateInteractionOutcome(
  runId: string,
  status: 'accepted' | 'unknown'
): Promise<void> {
  await storage(() =>
    runWithPgSystemContext(async client => {
      await client.query(
        `UPDATE backend_run_interactions SET status = $2, updated_at = NOW()
      WHERE resume_run_id = $1::uuid AND status IN ('submitting','unknown')`,
        [runId, status]
      );
    })
  );
}

export async function expireInteraction(id: string): Promise<void> {
  await storage(() =>
    runWithPgSystemContext(async client => {
      await client.query(
        `UPDATE backend_run_interactions SET status = 'expired', updated_at = NOW()
      WHERE id = $1::uuid AND status = 'pending' AND expires_at <= NOW()`,
        [id]
      );
    })
  );
}
