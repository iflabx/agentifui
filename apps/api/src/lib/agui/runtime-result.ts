import {
  type AgentProjectionSnapshot,
  AgentProtocolError,
} from '@agentifui/shared';

export const MAX_AGENT_RESULT_BYTES = 512000;
const TERMINAL_RESERVE_BYTES = 1024;

export function projectedAssistantMessages(snapshot: AgentProjectionSnapshot) {
  const outputIds = new Set(snapshot.outputMessageIds);
  return snapshot.messages.flatMap((message, order) =>
    outputIds.has(message.id) &&
    message.role === 'assistant' &&
    typeof message.content === 'string'
      ? [{ id: message.id, content: message.content, order }]
      : []
  );
}

export function assertAgentResultBudget(
  snapshot: AgentProjectionSnapshot
): void {
  const candidate = {
    executionStatus: 'interrupted',
    errorCode: 'X'.repeat(80),
    messages: projectedAssistantMessages(snapshot),
    agui: snapshot,
  };
  if (
    Buffer.byteLength(JSON.stringify(candidate), 'utf8') +
      TERMINAL_RESERVE_BYTES >
    MAX_AGENT_RESULT_BYTES
  ) {
    throw new AgentProtocolError('AGENT_RESULT_LIMIT');
  }
}
