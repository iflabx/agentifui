import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';

import type { ApiRuntimeConfig } from '../config';
import {
  AgentAppError,
  readAgentAdmissionLimits,
  resolveAgentApp,
} from '../lib/agent-app';
import { AgentPolicyError } from '../lib/agent-backends';
import { toUserFacingAgentError } from '../lib/agent-error';
import {
  executeHumanInputRun,
  reconcileHumanInputRun,
} from '../lib/agent-human-input-execution';
import { moderateInputText } from '../lib/agent-input-moderation';
import {
  expireInteraction,
  getInteractionForActor,
  getInteractionResponseReplay,
  listInteractions,
  publicAgentInteraction,
  reserveInteractionResponse,
  validateInteractionDecision,
} from '../lib/agent-interactions-repository';
import {
  type AgentDeliverables,
  parseStoredAgentDeliverables,
  publicAgentDeliverables,
} from '../lib/agent-result';
import {
  executeAgentRun,
  publicAgentRun,
  runStatusEvent,
} from '../lib/agent-run-execution';
import {
  AgentRunError,
  type AgentRunRecord,
  getRunForActor,
  recordRunDeliverables,
  reserveRun,
  saveRunResult,
} from '../lib/agent-runs-repository';
import {
  ROOT_TASK_HEADER,
  registerSubmission,
  rejectSubmission,
  submissionHash,
} from '../lib/agent-submissions';
import {
  describeNegotiatedRuntime,
  executeNegotiatedAgentRun,
} from '../lib/agui/runtime';
import { trackApiBackgroundTask } from '../lib/capacity-control';
import { getHumanInputState } from '../lib/langchain/human-input';
import {
  LangChainUpstreamError,
  getCapabilities,
  getPhase4Artifact,
  getPhase4Result,
  getRun,
  supportsResultArtifacts,
} from '../lib/langchain/transport';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import { buildRouteErrorPayload } from '../lib/route-error';
import { resolveIdentityFromSession } from '../lib/session-identity';
import { resolveRequestLocale } from './dify-proxy-route/helpers';
import {
  buildTrustedUserInputs,
  loadTrustedUserProfile,
} from './dify-proxy-route/trusted-user-context';

const UUID_PATTERN =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new AgentAppError(400, 'INVALID_AGENT_REQUEST');
  }
  return value.toLowerCase();
}

function routeParams(request: FastifyRequest) {
  return request.params as Record<string, string>;
}

async function context(request: FastifyRequest, config: ApiRuntimeConfig) {
  const identity = await resolveIdentityFromSession(request, config, {
    bypassCache: true,
  });
  if (identity.kind !== 'ok') {
    throw new AgentAppError(
      identity.kind === 'unauthorized' ? 401 : 503,
      identity.kind === 'unauthorized'
        ? 'AUTH_UNAUTHORIZED'
        : 'AUTH_VERIFY_FAILED'
    );
  }
  const app = await resolveAgentApp(
    uuid(routeParams(request).appId),
    identity.identity.userId,
    { allowDify: true }
  );
  return { actor: identity.identity, app };
}

function requireSameOrigin(request: FastifyRequest, config: ApiRuntimeConfig) {
  if (request.headers['sec-fetch-site'] === 'cross-site') {
    throw new AgentAppError(403, 'AGENT_ORIGIN_REJECTED');
  }
  const origin = request.headers.origin;
  if (!origin) return;
  const configured = [
    process.env.NEXT_PUBLIC_APP_URL,
    ...config.corsAllowedOrigins,
  ].filter((value): value is string => Boolean(value));
  if (
    !configured.some(value => {
      try {
        return new URL(value).origin === origin;
      } catch {
        return false;
      }
    })
  ) {
    throw new AgentAppError(403, 'AGENT_ORIGIN_REJECTED');
  }
}

function publicDeliverables(value: AgentDeliverables) {
  return publicAgentDeliverables(value);
}

function publicRunForApp(
  run: AgentRunRecord,
  app: Awaited<ReturnType<typeof resolveAgentApp>>
) {
  const publicRun = publicAgentRun(run);
  if (app.backendType !== 'langchain') delete publicRun.deliverables;
  return {
    ...publicRun,
    ...(app.backendType === 'langchain' &&
    typeof app.resultProfileEnabled === 'boolean' &&
    Boolean(run.native_run_id) &&
    !run.deliverables
      ? { deliverablesQueryAvailable: true }
      : {}),
  };
}

function phase4UpstreamError(error: unknown): AgentAppError {
  if (error instanceof LangChainUpstreamError) {
    if (error.status === 404)
      return new AgentAppError(404, 'AGENT_RESULT_NOT_FOUND');
    if (error.status === 409)
      return new AgentAppError(409, 'AGENT_RESULT_PENDING');
    if (error.status === 422)
      return new AgentAppError(422, 'AGENT_RESULT_UNAVAILABLE');
    if (error.status === 401 || error.status === 403)
      return new AgentAppError(503, 'AGENT_RESULT_AUTH_FAILED');
  }
  return new AgentAppError(503, 'AGENT_RESULT_UPSTREAM_UNAVAILABLE');
}

async function reauthorizeResultRun(
  app: Awaited<ReturnType<typeof resolveAgentApp>>,
  userId: string,
  runId: string
): Promise<AgentRunRecord> {
  const current = await getRunForActor(runId, userId, app.id);
  if (!current) throw new AgentAppError(404, 'AGENT_RUN_NOT_FOUND');
  if (current.config_fingerprint !== app.fingerprint)
    throw new AgentAppError(409, 'AGENT_CONFIG_CHANGED');
  return current;
}

async function loadPhase4Manifest(
  app: Awaited<ReturnType<typeof resolveAgentApp>>,
  run: AgentRunRecord,
  userId: string
): Promise<{ run: AgentRunRecord; manifest: AgentDeliverables }> {
  run = await reauthorizeResultRun(app, userId, run.id);
  if (app.backendType !== 'langchain' || !run.thread_id || !run.native_run_id)
    throw new AgentAppError(409, 'AGENT_RESULT_UNAVAILABLE');
  if (run.deliverables) {
    try {
      const manifest = parseStoredAgentDeliverables(run.deliverables);
      if (
        manifest.threadId !== run.thread_id ||
        manifest.runId !== run.native_run_id
      )
        throw new Error();
      return { run, manifest };
    } catch {
      throw new AgentAppError(503, 'AGENT_RESULT_INTEGRITY_FAILED');
    }
  }
  const config = {
    baseUrl: app.baseUrl,
    apiKey: app.apiKey,
    assistantId: app.assistantId,
  };
  let capabilities;
  try {
    capabilities = await getCapabilities(config);
  } catch (error) {
    throw phase4UpstreamError(error);
  }
  if (
    capabilities.assistantId !== app.assistantId ||
    !supportsResultArtifacts(capabilities)
  )
    throw new AgentAppError(409, 'AGENT_RESULT_UNSUPPORTED');
  let manifest: AgentDeliverables;
  try {
    manifest = await getPhase4Result(config, run.thread_id, run.native_run_id);
  } catch (error) {
    throw phase4UpstreamError(error);
  }
  if (manifest.resultStatus === 'ready') {
    try {
      run = await recordRunDeliverables(run.id, manifest);
    } catch (error) {
      if (error instanceof AgentRunError && error.statusCode < 500) throw error;
      throw new AgentAppError(503, 'AGENT_RESULT_SAVE_FAILED');
    }
  }
  run = await reauthorizeResultRun(app, userId, run.id);
  return { run, manifest };
}

export const agentRunsRoutes: FastifyPluginAsync<{
  config: ApiRuntimeConfig;
}> = async (server, options) => {
  const active = new Set<Promise<void>>();
  server.addHook('onRequest', async (_request, reply) => {
    reply.header('cache-control', 'private, no-store');
  });
  server.addHook('onClose', async () => {
    await Promise.allSettled([...active]);
  });
  server.setErrorHandler((error, request, reply) => {
    const expected =
      error instanceof AgentAppError ||
      error instanceof AgentRunError ||
      error instanceof AgentPolicyError;
    const candidateStatus = (error as { statusCode?: unknown } | null)
      ?.statusCode;
    const clientStatus =
      typeof candidateStatus === 'number' &&
      candidateStatus >= 400 &&
      candidateStatus < 500
        ? candidateStatus
        : undefined;
    const clientError = !expected && clientStatus !== undefined;
    const statusCode = expected ? error.statusCode : (clientStatus ?? 503);
    const code = expected
      ? error.code
      : clientError
        ? 'INVALID_AGENT_REQUEST'
        : 'AGENT_REQUEST_FAILED';
    const policyError = [
      'AGENT_CONCURRENCY_LIMIT',
      'AGENT_QUOTA_EXCEEDED',
      'CONTENT_MODERATION_BLOCKED',
      'CONTENT_MODERATION_UNAVAILABLE',
    ].includes(code)
      ? toUserFacingAgentError({
          status: statusCode,
          code,
          locale: resolveRequestLocale(request.headers['accept-language']),
        })
      : undefined;
    request.log.warn({ code, requestId: request.id }, '[Agent] request failed');
    reply
      .header('x-request-id', request.id)
      .status(statusCode)
      .send(
        buildRouteErrorPayload({
          request,
          statusCode,
          code,
          userMessage: policyError?.userMessage ?? code,
          retryable: policyError?.retryable ?? false,
        })
      );
  });

  server.get('/api/internal/apps/:appId/agent', async request => {
    const { app } = await context(request, options.config);
    return {
      app: {
        id: app.id,
        name: app.name,
        backendType: app.backendType ?? 'langchain',
      },
      ...describeNegotiatedRuntime(app),
    };
  });

  server.get(
    '/api/internal/apps/:appId/agent/conversations/:conversationId/interactions',
    async request => {
      const { app, actor } = await context(request, options.config);
      const conversationId = uuid(routeParams(request).conversationId);
      let interactions = await listInteractions(
        app,
        actor.userId,
        conversationId
      );
      if (app.humanInput) {
        const unresolved = await queryRowsWithPgSystemContext<{ id: string }>(
          `SELECT id FROM backend_runs WHERE conversation_id = $1::uuid AND user_id = $2::uuid
          AND service_instance_id = $3::uuid AND (execution_status IN ('submitting','running','unknown') OR persistence_status <> 'saved'
            OR EXISTS (SELECT 1 FROM backend_run_interactions interaction WHERE interaction.resume_run_id = backend_runs.id
              AND interaction.status IN ('submitting','unknown')))`,
          [conversationId, actor.userId, app.id]
        );
        for (const entry of unresolved) {
          const run = await getRunForActor(entry.id, actor.userId, app.id);
          if (!run) continue;
          try {
            await reconcileHumanInputRun({
              app,
              run,
              interaction: interactions.find(
                interaction => interaction.resume_run_id === run.id
              ),
            });
          } catch {
            request.log.warn(
              { runId: run.id, code: 'AGENT_RECONCILIATION_UNAVAILABLE' },
              '[Agent] status verification unavailable'
            );
          }
        }
        for (const interaction of interactions)
          await expireInteraction(interaction.id);
        interactions = await listInteractions(
          app,
          actor.userId,
          conversationId
        );
      }
      return { interactions: interactions.map(publicAgentInteraction) };
    }
  );

  server.post(
    '/api/internal/apps/:appId/agent/interactions/:interactionId/respond',
    { bodyLimit: 8192 },
    async (request, reply) => {
      requireSameOrigin(request, options.config);
      const { app, actor } = await context(request, options.config);
      if (!app.humanInput || app.backendType === 'dify')
        throw new AgentAppError(409, 'AGENT_INTERACTION_NOT_ENABLED');
      const interaction = await getInteractionForActor(
        app,
        actor.userId,
        uuid(routeParams(request).interactionId)
      );
      const response = validateInteractionDecision(
        request.body,
        interaction.prompt
      );
      const replay = await getInteractionResponseReplay({
        app,
        userId: actor.userId,
        interactionId: interaction.id,
        response,
      });
      if (replay)
        return reply
          .status(202)
          .send({ run: publicAgentRun(replay), replayed: true });
      if (!interaction.submission_id) {
        if (
          interaction.status !== 'pending' ||
          (interaction.expires_at &&
            new Date(interaction.expires_at).getTime() <= Date.now())
        ) {
          await expireInteraction(interaction.id);
          throw new AgentAppError(409, 'AGENT_INTERACTION_EXPIRED');
        }
      }
      if (response.comment) {
        const moderation = await moderateInputText({
          request,
          config: options.config,
          userId: actor.userId,
          text: response.comment,
        });
        if (
          moderation.outcome === 'block' ||
          moderation.outcome === 'unavailable'
        )
          throw new AgentPolicyError(
            moderation.outcome === 'block' ? 400 : 503,
            moderation.outcome === 'block'
              ? 'CONTENT_MODERATION_BLOCKED'
              : 'CONTENT_MODERATION_UNAVAILABLE'
          );
      }
      if (!interaction.submission_id) {
        const origin = await getRunForActor(
          interaction.origin_run_id,
          actor.userId,
          app.id
        );
        if (!origin?.thread_id)
          throw new AgentAppError(409, 'AGENT_INTERACTION_NOT_READY');
        const state = await getHumanInputState(app, origin.thread_id);
        if (
          !state.interrupt ||
          state.interrupt.id !== interaction.native_interrupt_id ||
          state.interrupt.checkpoint.checkpoint_id !==
            interaction.checkpoint.checkpoint_id
        ) {
          const latest = await getInteractionForActor(
            app,
            actor.userId,
            interaction.id
          );
          if (latest.submission_id !== response.submissionId)
            throw new AgentAppError(409, 'AGENT_INTERRUPT_CHANGED');
        }
      }
      const reservation = await reserveInteractionResponse({
        app,
        userId: actor.userId,
        interactionId: interaction.id,
        response,
        ...readAgentAdmissionLimits(),
      });
      if (!reservation.replayed) {
        const task = executeHumanInputRun({
          app,
          run: reservation.run,
          content: '',
          interaction: reservation.interaction,
          emit: () => undefined,
          agui: { emit: () => undefined },
          report: value =>
            request.log.warn(value, '[Agent] resume requires attention'),
        })
          .catch(() => undefined)
          .finally(() => active.delete(task));
        active.add(task);
        trackApiBackgroundTask(task);
      }
      return reply.status(202).send({
        run: publicAgentRun(reservation.run),
        replayed: reservation.replayed,
      });
    }
  );

  server.post(
    '/api/internal/apps/:appId/agent/runs',
    { bodyLimit: 64 * 1024 },
    async (request, reply) => {
      requireSameOrigin(request, options.config);
      const { app, actor } = await context(request, options.config);
      const protocol = request.headers['x-agentifui-protocol'];
      if (protocol !== undefined && protocol !== 'ag-ui/1.0')
        throw new AgentAppError(400, 'AGENT_PROTOCOL_UNSUPPORTED');
      const agui = protocol === 'ag-ui/1.0';
      if (app.backendType === 'dify' && !agui)
        throw new AgentAppError(409, 'AGENT_PROTOCOL_REQUIRED');
      if (app.backendType === 'langchain' && app.resultProfileEnabled === false)
        throw new AgentAppError(409, 'AGENT_RESULT_PROFILE_DISABLED');
      const body = request.body as Record<string, unknown> | null;
      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some(
          key => !['submissionId', 'conversationId', 'content'].includes(key)
        ) ||
        typeof body.content !== 'string' ||
        !body.content.trim() ||
        body.content.length > 16000
      ) {
        throw new AgentAppError(400, 'INVALID_AGENT_REQUEST');
      }
      if (
        app.backendType === 'dify' &&
        !body.conversationId &&
        app.interactionProtocol !== 'ag-ui/1.0'
      )
        throw new AgentAppError(409, 'AGENT_INTERACTION_NOT_ENABLED');
      const registration = await registerSubmission({
        credentialVersion: app.credentialVersion,
        userId: actor.userId,
        serviceInstanceId: app.id,
        submissionId: uuid(body.submissionId),
        backendType: app.backendType ?? 'langchain',
        targetFingerprint: submissionHash([
          app.id,
          app.baseUrl,
          app.assistantId,
        ]),
        request: {
          content: body.content,
          conversationId: body.conversationId ?? null,
        },
      });
      const rootTaskId = registration.task.root_task_id;
      reply.header(ROOT_TASK_HEADER, rootTaskId);
      if (registration.replayed && !registration.task.run_id)
        throw new AgentPolicyError(
          409,
          registration.task.error_code ?? 'AGENT_SUBMISSION_IN_PROGRESS'
        );
      let difyInputs: Record<string, string> = {};
      if (!registration.replayed) {
        if (app.backendType === 'dify')
          difyInputs = buildTrustedUserInputs(
            actor,
            await loadTrustedUserProfile(actor.userId)
          );
        const moderation = await moderateInputText({
          request,
          config: options.config,
          userId: actor.userId,
          text:
            app.backendType === 'dify'
              ? [body.content, ...Object.values(difyInputs)].join('\n')
              : body.content,
        });
        if (
          moderation.outcome === 'block' ||
          moderation.outcome === 'unavailable'
        ) {
          const code =
            moderation.outcome === 'block'
              ? 'CONTENT_MODERATION_BLOCKED'
              : 'CONTENT_MODERATION_UNAVAILABLE';
          await rejectSubmission(rootTaskId, code);
          throw new AgentPolicyError(
            moderation.outcome === 'block' ? 400 : 503,
            code
          );
        }
      }
      let reservation;
      try {
        reservation = await reserveRun({
          governanceTaskId: rootTaskId,
          backendType: app.backendType ?? 'langchain',
          userId: actor.userId,
          serviceInstanceId: app.id,
          appInstanceId: app.instanceId,
          configFingerprint: app.fingerprint,
          submissionId: uuid(body.submissionId),
          conversationId:
            body.conversationId === undefined
              ? undefined
              : uuid(body.conversationId),
          content: body.content,
          ...readAgentAdmissionLimits(),
        });
      } catch (error) {
        if (
          !registration.replayed &&
          (error instanceof AgentRunError ||
            error instanceof AgentPolicyError) &&
          error.statusCode < 500
        )
          await rejectSubmission(rootTaskId, error.code);
        throw error;
      }
      const { run, replayed } = reservation;
      if (agui && replayed) {
        return reply.status(409).send({
          code: 'AGENT_SUBMISSION_REPLAY',
          run: publicAgentRun(run),
        });
      }
      if (agui) reply.header('x-agentifui-protocol', 'ag-ui/1.0');
      reply.header('content-type', 'text/event-stream; charset=utf-8');
      reply.header('cache-control', 'no-cache, no-transform');
      reply.header('x-accel-buffering', 'no');
      reply.header('x-request-id', request.id);
      reply.hijack();
      for (const [name, value] of Object.entries(reply.getHeaders())) {
        if (value !== undefined)
          reply.raw.setHeader(
            name,
            typeof value === 'number' ? String(value) : value
          );
      }
      reply.raw.writeHead(200);
      const emit = (event: unknown) => {
        if (reply.raw.destroyed || reply.raw.writableEnded) return;
        try {
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
          if (reply.raw.writableLength > 1024 * 1024) reply.raw.destroy();
        } catch {
          reply.raw.destroy();
        }
      };
      if (!agui)
        emit({
          type: 'accepted',
          conversationId: run.conversation_id,
          runId: run.id,
          userMessageId: run.user_message_id,
        });
      if (replayed) {
        emit(runStatusEvent(run));
        reply.raw.end();
        return;
      }
      const heartbeat = setInterval(() => {
        if (!reply.raw.destroyed && !reply.raw.writableEnded)
          reply.raw.write(': keepalive\n\n');
      }, 15000);
      heartbeat.unref();
      const execution = {
        rootTaskId,
        app,
        run,
        content: body.content,
        emit,
        ...(agui ? { agui: { emit } } : {}),
        report: (value: { runId: string; code: string }) =>
          request.log.warn(value, '[Agent] run requires attention'),
      };
      const task = (
        agui
          ? executeNegotiatedAgentRun({ ...execution, inputs: difyInputs })
          : executeAgentRun(execution)
      )
        .catch(() => {
          if (!agui)
            emit({
              type: 'status',
              runId: run.id,
              conversationId: run.conversation_id,
              executionStatus: 'unknown',
              persistenceStatus: 'failed',
              errorCode: 'AGENT_RESULT_UNKNOWN',
            });
        })
        .finally(() => {
          clearInterval(heartbeat);
          if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
          active.delete(task);
        });
      active.add(task);
      trackApiBackgroundTask(task);
    }
  );

  server.get('/api/internal/apps/:appId/agent/conversations', async request => {
    const { app, actor } = await context(request, options.config);
    const conversations = await queryRowsWithPgSystemContext(
      `SELECT c.id::text, c.title, c.updated_at::text, c.last_message_preview
       FROM conversations c JOIN backend_conversations b ON b.conversation_id = c.id
       WHERE c.user_id = $1::uuid AND b.service_instance_id = $2::uuid AND c.status = 'active'
         AND b.config_fingerprint = $3 AND b.backend_type = $4
       ORDER BY c.updated_at DESC, c.id DESC LIMIT 100`,
      [actor.userId, app.id, app.fingerprint, app.backendType ?? 'langchain']
    );
    return { conversations };
  });

  server.get(
    '/api/internal/apps/:appId/agent/conversations/:conversationId',
    async request => {
      const { app, actor } = await context(request, options.config);
      const conversationId = uuid(routeParams(request).conversationId);
      const conversations = await queryRowsWithPgSystemContext(
        `SELECT c.id::text, c.title, c.updated_at::text, c.status, c.app_id, c.metadata,
          EXISTS (SELECT 1 FROM messages legacy WHERE legacy.conversation_id = c.id
            AND legacy.metadata ? 'tools' AND legacy.metadata->'tools' <> '[]'::jsonb)
          OR EXISTS (SELECT 1 FROM backend_runs legacy WHERE legacy.conversation_id = c.id
            AND NOT (legacy.result ? 'agui') AND jsonb_path_exists(legacy.result, '$.messages[*].tools[*]')) AS legacy_tools
       FROM conversations c JOIN backend_conversations b ON b.conversation_id = c.id
       WHERE c.id = $1::uuid AND c.user_id = $2::uuid
         AND b.service_instance_id = $3::uuid AND c.status = 'active'
         AND b.config_fingerprint = $4 AND b.backend_type = $5 LIMIT 1`,
        [
          conversationId,
          actor.userId,
          app.id,
          app.fingerprint,
          app.backendType ?? 'langchain',
        ]
      );
      if (!conversations[0])
        throw new AgentAppError(404, 'AGENT_CONVERSATION_NOT_FOUND');
      const query = request.query as Record<string, unknown>;
      const before = query.before === undefined ? null : Number(query.before);
      const limit = query.limit === undefined ? 100 : Number(query.limit);
      if (
        (before !== null && (!Number.isSafeInteger(before) || before < 0)) ||
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > 100
      )
        throw new AgentAppError(400, 'INVALID_AGENT_REQUEST');
      const page = await queryRowsWithPgSystemContext(
        `SELECT id::text, role::text, content, metadata, status::text, created_at::text, sequence_index
       FROM messages WHERE conversation_id = $1::uuid
         AND ($2::integer IS NULL OR sequence_index < $2)
       ORDER BY sequence_index DESC, created_at DESC, id DESC LIMIT $3`,
        [conversationId, before, limit + 1]
      );
      const messages = page.slice(0, limit).reverse();
      const messageIds = messages.map(message => String(message.id));
      const runIds = messages.flatMap(message => {
        const id = (message.metadata as Record<string, unknown> | null)
          ?.backend_run_id;
        return typeof id === 'string' ? [id] : [];
      });
      const runs = await queryRowsWithPgSystemContext<AgentRunRecord>(
        `SELECT id, conversation_id, run_kind, root_run_id, native_run_id, execution_status, persistence_status, error_code, created_at, updated_at,
          deliverables,
          CASE WHEN persistence_status <> 'saved' OR result ? 'agui' THEN result ELSE NULL END AS result
       FROM backend_runs WHERE conversation_id = $1::uuid
         AND (user_message_id = ANY($2::uuid[]) OR id::text = ANY($3::text[]) OR run_kind = 'resume')
       ORDER BY created_at DESC, id DESC LIMIT 100`,
        [conversationId, messageIds, runIds]
      );
      const { legacy_tools: legacyTools, ...conversation } = conversations[0];
      return {
        conversation: { ...conversation, interaction_protocol: 'ag-ui/1.0' },
        messages,
        runs: runs.map(run => publicRunForApp(run, app)),
        nextCursor:
          page.length > limit ? String(messages[0].sequence_index) : null,
        protocol:
          app.backendType !== 'dify' && legacyTools
            ? 'agentifui/legacy'
            : 'ag-ui/1.0',
      };
    }
  );

  server.delete(
    '/api/internal/apps/:appId/agent/conversations/:conversationId',
    async (request, reply) => {
      requireSameOrigin(request, options.config);
      const { app, actor } = await context(request, options.config);
      const pending = await queryRowsWithPgSystemContext(
        `SELECT run.id FROM backend_runs run JOIN conversations conversation ON conversation.id = run.conversation_id
          WHERE run.conversation_id = $1::uuid AND conversation.user_id = $2::uuid AND run.service_instance_id = $3::uuid
          AND (run.execution_status IN ('reserved','submitting','running','unknown') OR run.persistence_status <> 'saved'
            OR EXISTS (SELECT 1 FROM backend_run_interactions interaction WHERE interaction.origin_run_id = run.id
              AND interaction.status IN ('pending','submitting','unknown','expired'))) LIMIT 1`,
        [uuid(routeParams(request).conversationId), actor.userId, app.id]
      );
      if (pending[0]) throw new AgentAppError(409, 'AGENT_CONVERSATION_BUSY');
      const rows = await queryRowsWithPgSystemContext(
        `UPDATE conversations c SET status = 'deleted', updated_at = NOW()
       FROM backend_conversations b WHERE b.conversation_id = c.id
         AND c.id = $1::uuid AND c.user_id = $2::uuid AND b.service_instance_id = $3::uuid
         AND b.config_fingerprint = $4 AND b.backend_type = $5
         AND c.status = 'active' RETURNING c.id`,
        [
          uuid(routeParams(request).conversationId),
          actor.userId,
          app.id,
          app.fingerprint,
          app.backendType ?? 'langchain',
        ]
      );
      if (!rows[0])
        throw new AgentAppError(404, 'AGENT_CONVERSATION_NOT_FOUND');
      reply.status(204).send();
    }
  );

  server.get(
    '/api/internal/apps/:appId/agent/runs/:runId/deliverables',
    async request => {
      const { app, actor } = await context(request, options.config);
      let run = await getRunForActor(
        uuid(routeParams(request).runId),
        actor.userId,
        app.id
      );
      if (!run) throw new AgentAppError(404, 'AGENT_RUN_NOT_FOUND');
      if (run.config_fingerprint !== app.fingerprint)
        throw new AgentAppError(409, 'AGENT_CONFIG_CHANGED');
      const loaded = await loadPhase4Manifest(app, run, actor.userId);
      run = loaded.run;
      return {
        runId: run.id,
        conversationId: run.conversation_id,
        deliverables: publicDeliverables(loaded.manifest),
      };
    }
  );

  server.get(
    '/api/internal/apps/:appId/agent/runs/:runId/artifacts/:artifactId',
    async (request, reply) => {
      const { app, actor } = await context(request, options.config);
      const artifactId = routeParams(request).artifactId;
      if (artifactId !== 'report' && artifactId !== 'data')
        throw new AgentAppError(404, 'AGENT_ARTIFACT_NOT_FOUND');
      let run = await getRunForActor(
        uuid(routeParams(request).runId),
        actor.userId,
        app.id
      );
      if (!run) throw new AgentAppError(404, 'AGENT_RUN_NOT_FOUND');
      if (run.config_fingerprint !== app.fingerprint)
        throw new AgentAppError(409, 'AGENT_CONFIG_CHANGED');
      const loaded = await loadPhase4Manifest(app, run, actor.userId);
      run = loaded.run;
      const artifact = loaded.manifest.artifacts.find(
        item => item.artifactId === artifactId
      );
      if (!artifact || loaded.manifest.resultStatus !== 'ready')
        throw new AgentAppError(
          loaded.manifest.resultStatus === 'pending' ? 409 : 422,
          loaded.manifest.resultStatus === 'pending'
            ? 'AGENT_RESULT_PENDING'
            : 'AGENT_RESULT_UNAVAILABLE'
        );
      let downloaded;
      try {
        downloaded = await getPhase4Artifact(
          {
            baseUrl: app.baseUrl,
            apiKey: app.apiKey,
            assistantId: app.assistantId,
          },
          run.thread_id!,
          run.native_run_id!,
          artifactId
        );
      } catch (error) {
        throw phase4UpstreamError(error);
      }
      const digest = createHash('sha256')
        .update(downloaded.bytes)
        .digest('hex');
      if (
        downloaded.bytes.byteLength !== artifact.sizeBytes ||
        digest !== artifact.sha256 ||
        downloaded.contentType !== artifact.mediaType
      )
        throw new AgentAppError(503, 'AGENT_RESULT_INTEGRITY_FAILED');
      await reauthorizeResultRun(app, actor.userId, run.id);
      reply
        .header('content-type', artifact.mediaType)
        .header('content-length', String(downloaded.bytes.byteLength))
        .header(
          'content-disposition',
          `attachment; filename="${artifact.filename}"`
        )
        .header('cache-control', 'no-store')
        .header('x-content-type-options', 'nosniff')
        .send(Buffer.from(downloaded.bytes));
    }
  );

  server.get('/api/internal/apps/:appId/agent/runs/:runId', async request => {
    const { app, actor } = await context(request, options.config);
    let run = await getRunForActor(
      uuid(routeParams(request).runId),
      actor.userId,
      app.id
    );
    if (!run) throw new AgentAppError(404, 'AGENT_RUN_NOT_FOUND');
    if (run.config_fingerprint !== app.fingerprint)
      throw new AgentAppError(409, 'AGENT_CONFIG_CHANGED');
    if (app.humanInput) {
      try {
        const interactions = await listInteractions(
          app,
          actor.userId,
          run.conversation_id
        );
        run = await reconcileHumanInputRun({
          app,
          run,
          interaction: interactions.find(
            interaction => interaction.resume_run_id === run!.id
          ),
        });
      } catch {
        request.log.warn(
          { runId: run.id, code: 'AGENT_RECONCILIATION_UNAVAILABLE' },
          '[Agent] status verification unavailable'
        );
      }
    }
    if (!app.humanInput && run.result && run.persistence_status !== 'saved') {
      try {
        run = await saveRunResult(run.id, run.result);
      } catch (error) {
        if (
          !(error instanceof AgentRunError) ||
          error.code !== 'AGENT_STORAGE_UNAVAILABLE'
        )
          throw error;
        run = {
          ...run,
          persistence_status: 'failed',
          error_code: 'AGENT_SAVE_FAILED',
        };
      }
    }
    let upstreamStatus: string | undefined;
    const stale = Date.now() - new Date(run.updated_at).getTime() > 180000;
    if (
      app.backendType !== 'dify' &&
      !app.humanInput &&
      (run.execution_status === 'unknown' || stale) &&
      run.thread_id &&
      run.native_run_id &&
      ['reserved', 'submitting', 'running', 'unknown'].includes(
        run.execution_status
      )
    ) {
      try {
        upstreamStatus = (await getRun(app, run.thread_id, run.native_run_id))
          .status;
      } catch {
        upstreamStatus = 'unknown';
      }
    }
    return {
      ...publicRunForApp(run, app),
      ...(upstreamStatus ? { upstreamStatus } : {}),
    };
  });
};
