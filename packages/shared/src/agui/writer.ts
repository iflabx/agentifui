import {
  AGENT_RUN_FAILURES,
  AGUI_PROTOCOL_VERSION,
  AGUI_TOOL_SUMMARY,
  AgentProtocolError,
  type AgentRunContext,
  type AgentRunFailure,
  type AgentToolSummary,
  type Event,
  EventType,
  type Message,
  parseAgentEvent,
  parseAgentMessages,
} from './contract';
import { readAgentHistoryMessages } from './history-messages';

export class AgentEventWriter {
  private started = false;
  private closed = false;
  private messages: Message[];
  private readonly owned = new Set<string>();
  private readonly open = new Set<string>();
  private readonly context: AgentRunContext;

  constructor(context: AgentRunContext) {
    for (const value of [
      context.threadId,
      context.runId,
      context.submissionId,
      context.userMessageId,
    ]) {
      if (typeof value !== 'string' || !value || value.length > 255) {
        throw new AgentProtocolError('AGENT_CONTEXT_INVALID');
      }
    }
    this.context = { ...context, history: undefined };
    this.messages = readAgentHistoryMessages(context.history ?? []);
  }

  start(): Event[] {
    if (this.started || this.closed) {
      throw new AgentProtocolError('AGENT_RUN_ALREADY_STARTED');
    }
    this.started = true;
    return this.events([
      {
        type: EventType.RUN_STARTED,
        protocolVersion: AGUI_PROTOCOL_VERSION,
        threadId: this.context.threadId,
        runId: this.context.runId,
        metadata: {
          'agentifui.acceptance.v1': {
            submissionId: this.context.submissionId,
            userMessageId: this.context.userMessageId,
          },
        },
      },
    ]);
  }

  text(messageId: string, delta: string): Event[] {
    this.requireActive();
    this.requireMessageId(messageId);
    if (typeof delta !== 'string') {
      throw new AgentProtocolError('AGENT_TEXT_INVALID');
    }
    let message = this.messages.find(item => item.id === messageId);
    const events: Event[] = [];
    if (!message) {
      message = { id: messageId, role: 'assistant', content: '' };
      events.push({
        type: EventType.TEXT_MESSAGE_START,
        messageId,
        role: 'assistant',
      });
    }
    if (
      (events.length === 0 &&
        (!this.owned.has(messageId) || !this.open.has(messageId))) ||
      message.role !== 'assistant' ||
      typeof message.content !== 'string'
    ) {
      throw new AgentProtocolError('AGENT_MESSAGE_OWNERSHIP');
    }
    const updated = { ...message, content: message.content + delta };
    const messages = events.length
      ? [...this.messages, updated]
      : this.messages.map(item => (item.id === messageId ? updated : item));
    parseAgentMessages(messages);
    this.messages = messages;
    this.owned.add(messageId);
    this.open.add(messageId);
    events.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta });
    return this.events(events);
  }

  replace(messageId: string, content: string): Event[] {
    this.requireActive();
    this.requireMessageId(messageId);
    const existing = this.messages.find(item => item.id === messageId);
    if (
      typeof content !== 'string' ||
      (existing &&
        (!this.owned.has(messageId) || existing.role !== 'assistant'))
    ) {
      throw new AgentProtocolError('AGENT_MESSAGE_OWNERSHIP');
    }
    const message: Message = { id: messageId, role: 'assistant', content };
    const messages = parseAgentMessages(
      existing
        ? this.messages.map(item => (item.id === messageId ? message : item))
        : [...this.messages, message]
    );
    this.messages = messages;
    this.owned.add(messageId);
    return this.events([
      {
        type: EventType.MESSAGES_SNAPSHOT,
        messages,
      },
    ]);
  }

  toolSummary(messageId: string, summary: AgentToolSummary): Event[] {
    this.requireActive();
    this.requireMessageId(messageId);
    const existing = this.messages.find(item => item.id === messageId);
    if (
      typeof summary.name !== 'string' ||
      !/^[\w .:-]{1,128}$/.test(summary.name) ||
      !['running', 'completed'].includes(summary.status) ||
      (summary.parentMessageId !== undefined &&
        (!this.owned.has(summary.parentMessageId) ||
          !this.messages.some(
            item =>
              item.id === summary.parentMessageId && item.role === 'assistant'
          ))) ||
      (existing && (!this.owned.has(messageId) || existing.role !== 'activity'))
    ) {
      throw new AgentProtocolError('AGENT_ACTIVITY_INVALID');
    }
    const content = {
      name: summary.name,
      status: summary.status,
      ...(summary.parentMessageId
        ? { parentMessageId: summary.parentMessageId }
        : {}),
    };
    const activity: Message = {
      id: messageId,
      role: 'activity',
      activityType: AGUI_TOOL_SUMMARY,
      content,
    };
    const messages = existing
      ? this.messages.map(item => (item.id === messageId ? activity : item))
      : [...this.messages, activity];
    parseAgentMessages(messages);
    this.messages = messages;
    this.owned.add(messageId);
    return this.events([
      {
        type: EventType.ACTIVITY_SNAPSHOT,
        messageId,
        activityType: AGUI_TOOL_SUMMARY,
        content,
        replace: true,
      },
    ]);
  }

  finish(outcome: 'success' | 'cancelled' = 'success'): Event[] {
    this.requireActive();
    if (outcome !== 'success' && outcome !== 'cancelled') {
      throw new AgentProtocolError('AGENT_OUTCOME_INVALID');
    }
    const events = this.closeMessages();
    this.closed = true;
    return this.events([
      ...events,
      {
        type: EventType.RUN_FINISHED,
        threadId: this.context.threadId,
        runId: this.context.runId,
        outcome: { type: outcome },
      },
    ]);
  }

  fail(code: AgentRunFailure = 'AGENT_RUN_FAILED'): Event[] {
    if (this.closed) throw new AgentProtocolError('AGENT_RUN_CLOSED');
    if (!AGENT_RUN_FAILURES.includes(code)) {
      throw new AgentProtocolError('AGENT_FAILURE_INVALID');
    }
    const events = this.closeMessages();
    this.closed = true;
    return this.events([
      ...events,
      { type: EventType.RUN_ERROR, code, message: 'Agent execution failed.' },
    ]);
  }

  private closeMessages(): Event[] {
    const events = [...this.open].map(messageId => ({
      type: EventType.TEXT_MESSAGE_END as const,
      messageId,
    }));
    this.open.clear();
    return events;
  }

  private requireActive(): void {
    if (!this.started || this.closed) {
      throw new AgentProtocolError('AGENT_RUN_NOT_ACTIVE');
    }
  }

  private requireMessageId(messageId: string): void {
    if (
      typeof messageId !== 'string' ||
      !messageId ||
      messageId.length > 255 ||
      messageId === this.context.userMessageId
    ) {
      throw new AgentProtocolError('AGENT_MESSAGE_ID_INVALID');
    }
  }

  private events(events: Event[]): Event[] {
    return events.map(event => parseAgentEvent(event)!);
  }
}
