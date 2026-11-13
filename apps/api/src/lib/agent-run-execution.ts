import { randomUUID } from 'node:crypto';

import type { AgentApp } from './agent-app';
import {
  type AgentRunRecord,
  type AgentRunResult,
  type AgentSavedMessage,
  bindThread,
  markRunUnknown,
  recordNativeRun,
  saveRunResult,
} from './agent-runs-repository';
import {
  LangChainUpstreamError,
  createThread,
  streamTurn,
} from './langchain/transport';

export interface AgentToolSummary {
  toolCallId: string;
  name: string;
  status: 'running' | 'completed';
  summary?: string;
}

export type AgentClientEvent =
  | {
      type: 'accepted';
      conversationId: string;
      runId: string;
      userMessageId: string;
    }
  | { type: 'text'; messageId: string; delta: string }
  | ({ type: 'tool' } & AgentToolSummary)
  | {
      type: 'status';
      conversationId: string;
      runId: string;
      executionStatus: AgentRunRecord['execution_status'];
      persistenceStatus: AgentRunRecord['persistence_status'];
      errorCode?: string;
    };

export function publicAgentRun(run: AgentRunRecord) {
  return {
    id: run.id,
    runId: run.id,
    conversationId: run.conversation_id,
    executionStatus: run.execution_status,
    persistenceStatus: run.persistence_status,
    ...(run.error_code ? { errorCode: run.error_code } : {}),
    createdAt: run.created_at,
    updatedAt: run.updated_at,
  };
}

export function runStatusEvent(run: AgentRunRecord): AgentClientEvent {
  return {
    type: 'status',
    conversationId: run.conversation_id,
    runId: run.id,
    executionStatus: run.execution_status,
    persistenceStatus: run.persistence_status,
    ...(run.error_code ? { errorCode: run.error_code } : {}),
  };
}

export async function executeAgentRun(input: {
  app: AgentApp;
  run: AgentRunRecord;
  content: string;
  emit: (event: AgentClientEvent) => void;
  report: (context: {
    runId: string;
    code: string;
    orphanThreadId?: string;
  }) => void;
}): Promise<void> {
  let run = input.run;
  const messages = new Map<string, AgentSavedMessage>();
  const tools = new Map<string, AgentToolSummary>();
  let executionStatus: AgentRunResult['executionStatus'] = 'unknown';
  let errorCode: string | undefined;
  let knownThreadId: string | undefined;
  let visibleBytes = 0;
  try {
    knownThreadId = run.thread_id || (await createThread(input.app)).threadId;
    try {
      run = await bindThread(run.id, knownThreadId);
    } catch {
      run = await bindThread(run.id, knownThreadId);
    }
    for await (const event of streamTurn(input.app, {
      threadId: knownThreadId,
      runId: run.id,
      messageId: run.user_message_id,
      content: input.content,
    })) {
      switch (event.type) {
        case 'CUSTOM':
          run = await recordNativeRun(run.id, event.value.run_id);
          break;
        case 'TEXT_MESSAGE_START': {
          if (messages.size >= 64)
            throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
          const message = { id: randomUUID(), content: '' };
          messages.set(event.messageId, message);
          input.emit({ type: 'text', messageId: message.id, delta: '' });
          break;
        }
        case 'TEXT_MESSAGE_CONTENT': {
          const message = messages.get(event.messageId);
          if (!message)
            throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
          visibleBytes += Buffer.byteLength(event.delta, 'utf8');
          if (visibleBytes > 64 * 1024)
            throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
          message.content += event.delta;
          input.emit({
            type: 'text',
            messageId: message.id,
            delta: event.delta,
          });
          break;
        }
        case 'TOOL_CALL_START': {
          if (tools.size >= 64)
            throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
          const tool: AgentToolSummary = {
            toolCallId: event.toolCallId,
            name: event.toolCallName,
            status: 'running',
          };
          tools.set(event.toolCallId, tool);
          input.emit({ type: 'tool', ...tool });
          break;
        }
        case 'TOOL_CALL_RESULT': {
          const tool = tools.get(event.toolCallId);
          if (!tool)
            throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
          tool.status = 'completed';
          input.emit({ type: 'tool', ...tool });
          break;
        }
        case 'RUN_FINISHED':
          executionStatus = 'success';
          break;
        case 'RUN_ERROR':
          executionStatus = ['RUN_INCOMPLETE', 'AGENT_STREAM_FAILED'].includes(
            event.code
          )
            ? 'unknown'
            : 'error';
          errorCode = event.code;
          break;
      }
    }
  } catch (error) {
    const rejectedBeforeExecution =
      error instanceof LangChainUpstreamError &&
      (error.code === 'INVALID_REQUEST' ||
        (error.code === 'UPSTREAM_HTTP_ERROR' &&
          error.status !== undefined &&
          [400, 401, 403, 404, 405, 413, 415, 422].includes(error.status)));
    executionStatus = rejectedBeforeExecution ? 'error' : 'unknown';
    errorCode =
      error instanceof LangChainUpstreamError
        ? error.code
        : 'AGENT_RESULT_UNKNOWN';
    input.report({
      runId: run.id,
      code: errorCode,
      ...(knownThreadId && !run.thread_id
        ? { orphanThreadId: knownThreadId }
        : {}),
    });
  }
  const savedMessages = [...messages.values()];
  if (tools.size) {
    if (!savedMessages.length)
      savedMessages.push({ id: randomUUID(), content: '' });
    savedMessages[0].tools = [...tools.values()];
  }
  const result: AgentRunResult = {
    executionStatus,
    messages: savedMessages,
    ...(errorCode ? { errorCode } : {}),
  };
  try {
    try {
      run = await saveRunResult(run.id, result);
    } catch {
      run = await saveRunResult(run.id, result);
    }
    input.emit(runStatusEvent(run));
  } catch {
    await markRunUnknown(run.id, 'AGENT_SAVE_FAILED').catch(() => undefined);
    input.report({ runId: run.id, code: 'AGENT_SAVE_FAILED' });
    input.emit({
      type: 'status',
      runId: run.id,
      conversationId: run.conversation_id,
      executionStatus,
      persistenceStatus: 'failed',
      errorCode: 'AGENT_SAVE_FAILED',
    });
  }
}
