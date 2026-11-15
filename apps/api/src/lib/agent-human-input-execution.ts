import {
  AGUI_PROTOCOL_VERSION,
  AgentEventProjection,
  type Event,
  EventType,
} from '@agentifui/shared';
import { createHash } from 'node:crypto';

import type { AgentApp } from './agent-app';
import {
  type AgentInteractionRecord,
  markResumeSubmitting,
  recordInteraction,
  releaseUndispatchedResume,
  updateInteractionOutcome,
} from './agent-interactions-repository';
import type { AgentClientEvent } from './agent-run-execution';
import {
  type AgentRunRecord,
  type AgentRunResult,
  bindThread,
  getRunForActor,
  loadRunDisplayHistory,
  markRunUnknown,
  recordNativeRun,
  recordRunPersistenceFailure,
  saveRunResult,
} from './agent-runs-repository';
import {
  type AgentSubmission,
  confirmSubmission,
  markSubmissionSubmitting,
  rejectSubmission,
  rejectUnacceptedSubmission,
} from './agent-submissions';
import { projectedAssistantMessages } from './agui/runtime-result';
import {
  findHumanInputRun,
  getHumanInputState,
  requireHumanInputCapabilities,
} from './langchain/human-input';
import {
  LangChainUpstreamError,
  createThread,
  getRun,
  streamNativeRun,
} from './langchain/transport';
import { queryRowsWithPgSystemContext } from './pg-context';

function localMessageId(runId: string, index: number) {
  const hash = createHash('sha256')
    .update(`${runId}:human-input-output:${index}`)
    .digest('hex');
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

type HumanInputSubmission = Pick<
  AgentSubmission,
  'root_task_id' | 'state' | 'quota_state'
>;

async function loadHumanInputSubmission(run: AgentRunRecord) {
  const rows = await queryRowsWithPgSystemContext<HumanInputSubmission>(
    `SELECT root_task_id, state, quota_state FROM agent_submissions WHERE run_id = $1::uuid AND user_id = $2::uuid AND service_instance_id = $3::uuid`,
    [run.root_run_id ?? run.id, run.user_id, run.service_instance_id]
  );
  return rows[0];
}

function hasAcceptanceEvidence(
  run: AgentRunRecord,
  submission?: HumanInputSubmission
) {
  return Boolean(
    run.native_run_id ||
    submission?.state === 'accepted' ||
    submission?.state === 'finished' ||
    submission?.quota_state === 'counted'
  );
}

export async function reconcileHumanInputRun(input: {
  app: AgentApp;
  run: AgentRunRecord;
  interaction?: AgentInteractionRecord;
  rootTaskId?: string;
  emit?: (event: Event) => void;
}): Promise<AgentRunRecord> {
  let run = await getRunForActor(input.run.id, input.run.user_id, input.app.id);
  if (!run) throw new Error('AGENT_RUN_NOT_FOUND');
  if (run.run_kind === 'resume' && run.execution_status === 'reserved') {
    return run;
  }
  const submission = await loadHumanInputSubmission(run);
  const rootTaskId = input.rootTaskId ?? submission?.root_task_id;
  if (run.result) {
    const saved =
      run.persistence_status === 'saved'
        ? run
        : await saveRunResult(run.id, run.result);
    if (run.run_kind === 'resume' && run.execution_status === 'success')
      await updateInteractionOutcome(run.id, 'accepted');
    if (
      run.run_kind !== 'resume' &&
      rootTaskId &&
      hasAcceptanceEvidence(run, submission)
    )
      await confirmSubmission(rootTaskId, 'finished');
    return saved;
  }
  if (!run.thread_id) return run;
  const nativeId =
    run.native_run_id ??
    (await findHumanInputRun(input.app, run.thread_id, run.id));
  if (!nativeId) return run;
  if (!run.native_run_id) run = await recordNativeRun(run.id, nativeId);
  const nativeRun = await getRun(input.app, run.thread_id!, nativeId);
  const state = await getHumanInputState(input.app, run.thread_id!);
  if (rootTaskId) await confirmSubmission(rootTaskId, 'accepted');
  if (nativeRun.status === 'pending' || nativeRun.status === 'running')
    return run;
  let status: AgentRunResult['executionStatus'];
  let interaction: AgentInteractionRecord | undefined;
  if (state.interrupt) {
    if (run.run_kind === 'resume') {
      await markRunUnknown(run.id, 'AGENT_RESUME_RESULT_UNKNOWN');
      await updateInteractionOutcome(run.id, 'unknown');
      return (await getRunForActor(run.id, run.user_id, input.app.id))!;
    }
    interaction = await recordInteraction(run, state.interrupt);
    status = 'waiting';
  } else if (
    nativeRun.status === 'success' &&
    state.decision &&
    (state.outcome === 'approved' || state.outcome === 'rejected')
  ) {
    if (
      run.run_kind !== 'resume' ||
      !input.interaction?.decision ||
      state.decision.action !== input.interaction.decision.action ||
      state.decision.comment !== input.interaction.decision.comment
    ) {
      await markRunUnknown(run.id, 'AGENT_RESUME_DECISION_MISMATCH');
      await updateInteractionOutcome(run.id, 'unknown');
      return (await getRunForActor(run.id, run.user_id, input.app.id))!;
    }
    status = 'success';
  } else if (nativeRun.status === 'error' || nativeRun.status === 'timeout') {
    if (run.run_kind === 'resume') {
      await markRunUnknown(run.id, 'AGENT_RESUME_RESULT_UNKNOWN');
      await updateInteractionOutcome(run.id, 'unknown');
      return (await getRunForActor(run.id, run.user_id, input.app.id))!;
    }
    status = 'error';
  } else {
    await markRunUnknown(run.id, 'AGENT_RESULT_UNKNOWN');
    if (run.run_kind === 'resume')
      await updateInteractionOutcome(run.id, 'unknown');
    return (await getRunForActor(run.id, run.user_id, input.app.id))!;
  }
  const projection = new AgentEventProjection({
    threadId: run.conversation_id,
    runId: run.id,
    history: await loadRunDisplayHistory(run),
  });
  const publish = (event: Event) => {
    projection.accept(event);
    input.emit?.(event);
  };
  publish({
    type: EventType.RUN_STARTED,
    protocolVersion: AGUI_PROTOCOL_VERSION,
    threadId: run.conversation_id,
    runId: run.id,
    metadata: {
      'agentifui.acceptance.v1': {
        submissionId: run.submission_id,
        ...(run.run_kind !== 'resume'
          ? { userMessageId: run.user_message_id }
          : {}),
        runKind: run.run_kind ?? 'turn',
        rootRunId: run.root_run_id ?? run.id,
      },
    },
  });
  if (status === 'success') {
    for (const [index, message] of state.messages.entries()) {
      const messageId = localMessageId(run.id, index);
      publish({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: 'assistant',
      });
      publish({
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId,
        delta: message.content,
      });
      publish({ type: EventType.TEXT_MESSAGE_END, messageId });
    }
  }
  if (status === 'error') {
    publish({
      type: EventType.RUN_ERROR,
      code: 'AGENT_RUN_FAILED',
      message: 'Agent execution failed.',
    });
  } else {
    publish({
      type: EventType.RUN_FINISHED,
      threadId: run.conversation_id,
      runId: run.id,
      outcome: interaction
        ? {
            type: 'interrupt',
            interrupts: [
              {
                id: interaction.id,
                reason: 'human-input',
                message: interaction.prompt.title,
                responseSchema: {
                  type: 'object',
                  additionalProperties: false,
                  properties: {
                    action: {
                      type: 'string',
                      enum: interaction.prompt.actions,
                    },
                    comment: {
                      type: 'string',
                      maxLength: interaction.prompt.commentMaxLength,
                    },
                  },
                  required: ['action'],
                },
                ...(interaction.prompt.expiresAt
                  ? { expiresAt: interaction.prompt.expiresAt }
                  : {}),
              },
            ],
          }
        : { type: 'success' },
    });
  }
  const agui = projection.snapshot();
  const result: AgentRunResult = {
    executionStatus: status,
    messages: projectedAssistantMessages(agui),
    agui,
    ...(status === 'error' ? { errorCode: 'AGENT_RUN_FAILED' } : {}),
  };
  try {
    run = await saveRunResult(run.id, result);
  } catch (error) {
    await recordRunPersistenceFailure(run.id, result).catch(() => undefined);
    throw error;
  }
  if (run.run_kind === 'resume')
    await updateInteractionOutcome(run.id, 'accepted');
  if (rootTaskId) await confirmSubmission(rootTaskId, 'finished');
  return run;
}

export async function executeHumanInputRun(input: {
  rootTaskId?: string;
  app: AgentApp;
  run: AgentRunRecord;
  content: string;
  interaction?: AgentInteractionRecord;
  emit: (event: AgentClientEvent) => void;
  agui?: { emit: (event: Event) => void };
  report: (context: { runId: string; code: string }) => void;
}): Promise<void> {
  let run = input.run;
  let dispatched = false;
  try {
    await requireHumanInputCapabilities(input.app);
    if (run.run_kind === 'resume') {
      if (!input.interaction?.decision || !run.thread_id)
        throw new Error('AGENT_RESUME_INVALID');
      const current = await getHumanInputState(input.app, run.thread_id);
      if (
        !current.interrupt ||
        current.interrupt.id !== input.interaction.native_interrupt_id ||
        current.interrupt.checkpoint.checkpoint_id !==
          input.interaction.checkpoint.checkpoint_id
      )
        throw new Error('AGENT_INTERRUPT_CHANGED');
    } else {
      const threadId =
        run.thread_id ?? (await createThread(input.app)).threadId;
      run = await bindThread(run.id, threadId);
    }
    const body = {
      assistant_id: input.app.assistantId,
      ...(input.interaction
        ? {
            command: {
              resume: {
                [input.interaction.native_interrupt_id]:
                  input.interaction.decision,
              },
            },
          }
        : { input: { messages: [{ role: 'user', content: input.content }] } }),
      stream_mode: ['messages-tuple', 'updates'],
      on_disconnect: 'continue',
      multitask_strategy: 'reject',
      metadata: { agentifui_run_id: run.id },
    };
    await streamNativeRun(
      input.app,
      run.thread_id!,
      body,
      async nativeId => {
        run = await recordNativeRun(run.id, nativeId);
        if (input.rootTaskId)
          await confirmSubmission(input.rootTaskId, 'accepted');
      },
      async () => {
        if (input.interaction)
          await markResumeSubmitting({
            app: input.app,
            run,
            interaction: input.interaction,
          });
        else if (input.rootTaskId)
          await markSubmissionSubmitting(input.rootTaskId);
      },
      () => {
        dispatched = true;
      }
    );
    run = await reconcileHumanInputRun({
      ...input,
      run,
      emit: input.agui?.emit,
    });
    if (!run.result) {
      run = await markRunUnknown(run.id);
      if (input.interaction) await updateInteractionOutcome(run.id, 'unknown');
    }
  } catch (error) {
    const definitelyRejected =
      !dispatched ||
      (error instanceof LangChainUpstreamError &&
        error.code === 'UPSTREAM_HTTP_ERROR' &&
        [400, 401, 403, 404, 405, 413, 415, 422].includes(error.status ?? 0));
    if (input.interaction) {
      await releaseUndispatchedResume(run.id).catch(() => undefined);
      const durable = await getRunForActor(
        run.id,
        run.user_id,
        input.app.id
      ).catch(() => null);
      if (
        durable &&
        !durable.result &&
        ['submitting', 'running', 'unknown'].includes(durable.execution_status)
      ) {
        await markRunUnknown(run.id).catch(() => undefined);
        await updateInteractionOutcome(run.id, 'unknown').catch(
          () => undefined
        );
      }
    } else {
      let rejected = false;
      try {
        const durable = await getRunForActor(run.id, run.user_id, input.app.id);
        const submission = await loadHumanInputSubmission(run);
        if (
          durable &&
          !durable.result &&
          submission &&
          (!input.rootTaskId || submission.root_task_id === input.rootTaskId) &&
          !hasAcceptanceEvidence(durable, submission)
        ) {
          if (dispatched && definitelyRejected)
            await rejectUnacceptedSubmission(submission.root_task_id).catch(
              () => undefined
            );
          else if (!dispatched)
            await rejectSubmission(
              submission.root_task_id,
              'AGENT_NOT_DISPATCHED'
            ).catch(() => undefined);
          rejected =
            (await loadHumanInputSubmission(run))?.state === 'rejected';
        }
      } catch {
        rejected = false;
      }
      if (rejected) {
        await saveRunResult(run.id, {
          executionStatus: 'error',
          messages: [],
          errorCode: 'AGENT_RUN_FAILED',
        }).catch(() => undefined);
      } else {
        await markRunUnknown(run.id).catch(() => undefined);
        if (input.rootTaskId)
          await confirmSubmission(input.rootTaskId, 'unknown').catch(
            () => undefined
          );
      }
    }
    input.report({ runId: run.id, code: 'AGENT_RESULT_UNKNOWN' });
    if (input.agui)
      input.agui.emit({
        type: EventType.RUN_ERROR,
        code: 'AGENT_STREAM_INCOMPLETE',
        message: 'Agent result requires status verification.',
      });
  }
  if (!input.agui) {
    const latest = await getRunForActor(
      run.id,
      run.user_id,
      input.app.id
    ).catch(() => null);
    if (latest)
      input.emit({
        type: 'status',
        runId: latest.id,
        conversationId: latest.conversation_id,
        executionStatus: latest.execution_status,
        persistenceStatus: latest.persistence_status,
      });
  }
}
