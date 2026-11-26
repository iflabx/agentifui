import { type Event, EventType } from '@agentifui/shared';

import type { AgentApp } from '../agent-app';
import {
  type AgentRunRecord,
  type AgentRunResult,
  bindThread,
  loadRunDisplayHistory,
  recordNativeRun,
  recordRunPersistenceFailure,
  saveRunResult,
} from '../agent-runs-repository';
import {
  confirmSubmission,
  markSubmissionSubmitting,
  rejectSubmission,
  rejectUnacceptedSubmission,
} from '../agent-submissions';
import { DifyRunOutput } from './dify-output';
import {
  DifyChatIdentity,
  type DifyChatInputs,
  type DifyInputFile,
  DifyRuntimeError,
  streamDifyChatbot,
} from './dify-transport';
import { projectedAssistantMessages } from './runtime-result';

const REFUSAL_STATUSES = [400, 401, 403, 404, 405, 413, 415, 422];
const REFUSAL_CODES = new Set([
  'invalid_param',
  'unauthorized',
  'forbidden',
  'not_found',
  'app_unavailable',
  'provider_not_initialize',
  'model_currently_not_support',
]);

export async function executeDifyAgentRun(input: {
  rootTaskId: string;
  app: AgentApp;
  run: AgentRunRecord;
  content: string;
  inputs: DifyChatInputs;
  files?: DifyInputFile[];
  difyModeUnsupported?: boolean;
  emit: (event: Event) => void;
  report: (context: { runId: string; code: string }) => void;
}): Promise<void> {
  let run = input.run;
  let output: DifyRunOutput | undefined;
  let dispatched = false;
  let claimed = false;
  let accepted = false;
  let refused = false;
  let executionStatus: AgentRunResult['executionStatus'] = 'unknown';
  let errorCode: string | undefined;
  try {
    output = new DifyRunOutput(
      run,
      await loadRunDisplayHistory(run),
      input.emit
    );
    if (input.difyModeUnsupported)
      throw new DifyRuntimeError('DIFY_MODE_UNSUPPORTED');
    const identity = new DifyChatIdentity(run.thread_id);
    for await (const event of streamDifyChatbot({
      app: input.app,
      userId: run.user_id,
      content: input.content,
      inputs: input.inputs,
      files: input.files,
      nativeConversationId: run.thread_id,
      beforeDispatch: async () => {
        await markSubmissionSubmitting(input.rootTaskId);
        claimed = true;
      },
      onDispatch: () => {
        dispatched = true;
      },
    })) {
      const native = identity.accept(event);
      if (
        [
          'agent_message',
          'agent_thought',
          'workflow_started',
          'workflow_finished',
          'workflow_paused',
          'human_input_required',
          'node_started',
          'node_finished',
          'message_file',
          'tts_message',
          'tts_message_end',
        ].includes(String(event.event))
      )
        throw new DifyRuntimeError('DIFY_EVENT_UNSUPPORTED');
      if (native.conversationId && native.messageId) {
        if (!run.thread_id || run.execution_status === 'reserved') {
          run = await bindThread(run.id, native.conversationId);
        }
        if (!run.native_run_id)
          run = await recordNativeRun(run.id, native.messageId);
        if (!accepted) {
          await confirmSubmission(input.rootTaskId, 'accepted');
          accepted = true;
        }
      }
      if (event.event === 'error') {
        if (
          typeof event.status !== 'number' ||
          !Number.isSafeInteger(event.status) ||
          event.status < 0 ||
          typeof event.code !== 'string' ||
          !event.code ||
          event.code.length > 255 ||
          typeof event.message !== 'string'
        )
          throw new DifyRuntimeError('DIFY_ERROR_INVALID');
        refused =
          !accepted &&
          REFUSAL_STATUSES.includes(event.status) &&
          REFUSAL_CODES.has(String(event.code));
        executionStatus = accepted || refused ? 'error' : 'unknown';
        errorCode = refused ? 'AGENT_NATIVE_REJECTED' : 'AGENT_RUN_FAILED';
        output.fail(executionStatus === 'unknown');
        break;
      }
      output.accept(event);
      if (!['idle', 'running'].includes(output.snapshot().status)) break;
    }
    output.end();
    const snapshot = output.snapshot();
    executionStatus =
      snapshot.status === 'succeeded'
        ? 'success'
        : snapshot.status === 'failed'
          ? 'error'
          : 'unknown';
    errorCode ??= snapshot.errorCode;
    if (
      executionStatus === 'success' &&
      (!accepted || !run.thread_id || !run.native_run_id)
    )
      throw new DifyRuntimeError('DIFY_IDENTITY_INVALID');
  } catch (error) {
    refused =
      !accepted &&
      error instanceof DifyRuntimeError &&
      error.code === 'DIFY_UPSTREAM_HTTP_ERROR' &&
      REFUSAL_STATUSES.includes(error.status ?? 0);
    executionStatus = !dispatched || refused ? 'error' : 'unknown';
    errorCode =
      error &&
      typeof error === 'object' &&
      'code' in error &&
      typeof error.code === 'string' &&
      /^[A-Z][A-Z0-9_]{0,79}$/.test(error.code)
        ? error.code
        : 'AGENT_RESULT_UNKNOWN';
    output?.fail(executionStatus === 'unknown');
    input.report({ runId: run.id, code: errorCode });
  }
  if (!output)
    input.emit({
      type: EventType.RUN_ERROR,
      code: 'AGENT_RUN_FAILED',
      message: 'Agent execution failed.',
    });
  try {
    if (!dispatched) {
      if (claimed)
        await rejectUnacceptedSubmission(
          input.rootTaskId,
          'AGENT_NOT_DISPATCHED'
        );
      else await rejectSubmission(input.rootTaskId, 'AGENT_NOT_DISPATCHED');
    } else if (refused) await rejectUnacceptedSubmission(input.rootTaskId);
    else
      await confirmSubmission(
        input.rootTaskId,
        accepted && executionStatus !== 'unknown' ? 'finished' : 'unknown'
      );
  } catch {
    input.report({ runId: run.id, code: 'AGENT_GOVERNANCE_UNAVAILABLE' });
    await confirmSubmission(input.rootTaskId, 'unknown').catch(() => undefined);
  }
  const snapshot = output?.snapshot();
  const result: AgentRunResult = {
    executionStatus,
    messages: snapshot ? projectedAssistantMessages(snapshot) : [],
    ...(errorCode ? { errorCode } : {}),
    ...(snapshot ? { agui: snapshot } : {}),
  };
  try {
    try {
      await saveRunResult(run.id, result);
    } catch {
      await saveRunResult(run.id, result);
    }
  } catch {
    await recordRunPersistenceFailure(run.id, result).catch(() => undefined);
    input.report({ runId: run.id, code: 'AGENT_SAVE_FAILED' });
  }
}
