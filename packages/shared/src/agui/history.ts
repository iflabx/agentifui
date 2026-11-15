import {
  AGENT_RUN_FAILURES,
  AgentProtocolError,
  EventType,
  type Message,
  assertProjectionSize,
} from './contract';
import { readAgentHistoryMessages } from './history-messages';
import type { AgentProjectionSnapshot } from './projection';

export type AgentPersistenceStatus = 'pending' | 'saved' | 'failed';

export interface AgentHistoryResult {
  sourceVersion: 1 | 2;
  projection: AgentProjectionSnapshot;
  legacyTools: Array<{
    parentMessageId: string;
    name: string;
    status: 'running' | 'completed';
  }>;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentProtocolError('AGENT_HISTORY_INVALID');
  }
  return value as Record<string, unknown>;
}

function failureCode(value: unknown) {
  if (value === undefined) return undefined;
  return AGENT_RUN_FAILURES.find(code => code === value) ?? 'AGENT_RUN_FAILED';
}

function readOutputMessageIds(
  value: unknown,
  messages: readonly Message[]
): string[] {
  const outputs = new Set(
    messages
      .filter(message => message.role !== 'user')
      .map(message => message.id)
  );
  if (
    !Array.isArray(value) ||
    value.length > messages.length ||
    new Set(value).size !== value.length ||
    !value.every(id => typeof id === 'string' && outputs.has(id))
  ) {
    throw new AgentProtocolError('AGENT_HISTORY_OUTPUT_SCOPE_INVALID');
  }
  return [...value];
}

export function readAgentHistoryResult(
  value: unknown,
  identity: { threadId: string; runId: string }
): AgentHistoryResult {
  const source = record(value);
  assertProjectionSize(source);
  if (
    source.schemaVersion !== undefined &&
    source.schemaVersion !== 1 &&
    source.schemaVersion !== 2
  ) {
    throw new AgentProtocolError('AGENT_HISTORY_VERSION_UNSUPPORTED');
  }
  const result: AgentHistoryResult = {
    sourceVersion: source.schemaVersion === 2 ? 2 : 1,
    projection: {
      schemaVersion: 2,
      threadId: identity.threadId,
      runId: identity.runId,
      status: 'unknown',
      messages: [],
      outputMessageIds: [],
      warnings: [],
    },
    legacyTools: [],
  };
  if (source.schemaVersion === 2) {
    if (
      source.threadId !== identity.threadId ||
      source.runId !== identity.runId
    ) {
      throw new AgentProtocolError('AGENT_RUN_ID_MISMATCH');
    }
    if (
      !['succeeded', 'failed', 'unknown', 'cancelled', 'interrupted'].includes(
        source.status as string
      )
    ) {
      throw new AgentProtocolError('AGENT_HISTORY_STATUS_INVALID');
    }
    result.projection.status =
      source.status as AgentProjectionSnapshot['status'];
    result.projection.messages = readAgentHistoryMessages(source.messages);
    if (source.warnings !== undefined) {
      if (
        !Array.isArray(source.warnings) ||
        !source.warnings.every(warning => typeof warning === 'string')
      ) {
        throw new AgentProtocolError('AGENT_HISTORY_INVALID');
      }
      const allowed = new Set([
        'unrecognized-event',
        'unsupported-activity',
        'unsupported-content-parts',
        'stream-ended-without-terminal',
        'history-output-scope-unavailable',
        ...Object.values(EventType).map(event => `unsupported-event:${event}`),
      ]);
      result.projection.warnings = [
        ...new Set(source.warnings.filter(warning => allowed.has(warning))),
      ];
      if (source.warnings.some(warning => !allowed.has(warning))) {
        result.projection.warnings.push('unrecognized-history-warning');
      }
    }
    if (source.outputMessageIds === undefined) {
      if (
        !result.projection.warnings.includes('history-output-scope-unavailable')
      )
        result.projection.warnings.push('history-output-scope-unavailable');
    } else {
      result.projection.outputMessageIds = readOutputMessageIds(
        source.outputMessageIds,
        result.projection.messages
      );
    }
  } else {
    const statuses = {
      success: 'succeeded',
      error: 'failed',
      unknown: 'unknown',
      interrupted: 'interrupted',
    } as const;
    if (
      !Object.hasOwn(statuses, source.executionStatus as string) ||
      !Array.isArray(source.messages) ||
      source.messages.length > 64
    ) {
      throw new AgentProtocolError('AGENT_HISTORY_INVALID');
    }
    result.projection.status =
      statuses[source.executionStatus as keyof typeof statuses];
    result.projection.messages = readAgentHistoryMessages(
      source.messages.map(value => {
        const message = record(value);
        if (message.tools !== undefined) {
          if (!Array.isArray(message.tools))
            throw new AgentProtocolError('AGENT_HISTORY_INVALID');
          for (const value of message.tools) {
            const tool = record(value);
            if (
              typeof tool.name !== 'string' ||
              !/^[\w .:-]{1,128}$/.test(tool.name) ||
              !['running', 'completed'].includes(tool.status as string)
            ) {
              throw new AgentProtocolError('AGENT_HISTORY_INVALID');
            }
            result.legacyTools.push({
              parentMessageId: message.id as string,
              name: tool.name,
              status: tool.status as 'running' | 'completed',
            });
            if (result.legacyTools.length > 64)
              throw new AgentProtocolError('AGENT_PROJECTION_LIMIT');
          }
        }
        return { id: message.id, role: 'assistant', content: message.content };
      })
    );
    if (result.legacyTools.length)
      result.projection.warnings.push('legacy-tool-order-unavailable');
    result.projection.outputMessageIds = result.projection.messages.map(
      message => message.id
    );
  }
  const errorCode = failureCode(source.errorCode);
  if (errorCode) result.projection.errorCode = errorCode;
  assertProjectionSize(result);
  return result;
}

export function mergeAgentHistoryPage(
  existing: readonly Message[],
  page: readonly Message[],
  placement: 'before' | 'after' = 'after'
): Message[] {
  const current = readAgentHistoryMessages(existing);
  const incoming = readAgentHistoryMessages(page);
  const byId = new Map(current.map(message => [message.id, message]));
  for (const message of incoming) {
    const prior = byId.get(message.id);
    if (prior && prior.role !== message.role)
      throw new AgentProtocolError('AGENT_MESSAGE_ROLE_MISMATCH');
    byId.set(message.id, message);
  }
  const ordered =
    placement === 'before'
      ? [...incoming, ...current]
      : [...current, ...incoming];
  const ids = [...new Set(ordered.map(message => message.id))];
  return readAgentHistoryMessages(ids.map(id => byId.get(id)!));
}

export function mergeAgentHistoryResult(
  materialized: readonly Message[],
  history: AgentHistoryResult,
  persistenceStatus: AgentPersistenceStatus
): { messages: Message[]; persistenceStatus: AgentPersistenceStatus } {
  if (!['pending', 'saved', 'failed'].includes(persistenceStatus)) {
    throw new AgentProtocolError('AGENT_HISTORY_INVALID');
  }
  const snapshot = readAgentHistoryMessages(history.projection.messages);
  const outputIds = new Set(
    readOutputMessageIds(history.projection.outputMessageIds, snapshot)
  );
  const auxiliary = (message: Message) =>
    message.role === 'activity' || message.role === 'reasoning';
  const auxiliaryIds = new Set(
    snapshot
      .filter(message => outputIds.has(message.id) && auxiliary(message))
      .map(message => message.id)
  );
  const current = readAgentHistoryMessages(materialized);
  const savedById = new Map(current.map(message => [message.id, message]));
  const messages = current.filter(message => !auxiliaryIds.has(message.id));
  const available = (message: Message) =>
    savedById.has(message.id) ||
    (persistenceStatus !== 'saved' && outputIds.has(message.id));
  for (const [ordinal, message] of snapshot.entries()) {
    const saved = savedById.get(message.id);
    if (saved) {
      if (saved.role !== message.role)
        throw new AgentProtocolError('AGENT_MESSAGE_ROLE_MISMATCH');
      if (!auxiliary(message)) continue;
    }
    if (!outputIds.has(message.id)) continue;
    if (
      persistenceStatus === 'saved' &&
      message.role !== 'activity' &&
      message.role !== 'reasoning'
    )
      continue;
    if (auxiliary(message)) {
      const before = snapshot
        .slice(0, ordinal)
        .filter(item => !auxiliary(item))
        .at(-1);
      const after = snapshot.slice(ordinal + 1).find(item => !auxiliary(item));
      if (
        (before && !available(before)) ||
        (!before && after && !available(after))
      )
        continue;
    }
    const next = snapshot
      .slice(ordinal + 1)
      .find(item => messages.some(current => current.id === item.id));
    const previous = snapshot
      .slice(0, ordinal)
      .reverse()
      .find(item => messages.some(current => current.id === item.id));
    const index = next
      ? messages.findIndex(item => item.id === next.id)
      : previous
        ? messages.findIndex(item => item.id === previous.id) + 1
        : messages.length;
    messages.splice(index, 0, message);
  }
  return { messages: readAgentHistoryMessages(messages), persistenceStatus };
}
