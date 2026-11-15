import {
  AGUI_TOOL_SUMMARY,
  AgentProtocolError,
  type Message,
  parseAgentMessages,
} from './contract';

export function readAgentHistoryMessages(value: unknown): Message[] {
  return parseAgentMessages(value).map(message => {
    if (
      ['user', 'assistant', 'reasoning'].includes(message.role) &&
      typeof message.content === 'string'
    ) {
      if (
        message.subagentRunId !== undefined ||
        ('toolCalls' in message && message.toolCalls !== undefined) ||
        ('encryptedValue' in message && message.encryptedValue !== undefined)
      ) {
        throw new AgentProtocolError('AGENT_HISTORY_UNSUPPORTED');
      }
      return {
        id: message.id,
        role: message.role,
        content: message.content,
        ...('name' in message && message.name !== undefined
          ? { name: message.name }
          : {}),
      } as Message;
    }
    if (message.role === 'activity') {
      if (message.subagentRunId !== undefined) {
        throw new AgentProtocolError('AGENT_HISTORY_UNSUPPORTED');
      }
      if (message.activityType !== AGUI_TOOL_SUMMARY) {
        return {
          id: message.id,
          role: 'activity',
          activityType: message.activityType,
          content: {},
        };
      }
      const { name, status, parentMessageId } = message.content;
      if (
        typeof name !== 'string' ||
        !/^[\w .:-]{1,128}$/.test(name) ||
        !['running', 'completed'].includes(status) ||
        (parentMessageId !== undefined && typeof parentMessageId !== 'string')
      ) {
        throw new AgentProtocolError('AGENT_ACTIVITY_INVALID');
      }
      return {
        id: message.id,
        role: 'activity',
        activityType: AGUI_TOOL_SUMMARY,
        content: {
          name,
          status,
          ...(parentMessageId !== undefined ? { parentMessageId } : {}),
        },
      };
    }
    throw new AgentProtocolError('AGENT_HISTORY_UNSUPPORTED');
  });
}

export function agentModelInputMessages(
  history: readonly Message[]
): Message[] {
  return readAgentHistoryMessages(history).filter(
    message => message.role === 'user' || message.role === 'assistant'
  );
}
