import {
  AGENT_RUN_FAILURES,
  AGUI_TOOL_SUMMARY,
  AgentProtocolError,
  type AgentRunFailure,
  type Event,
  EventType,
  type Message,
  assertProjectionSize,
  parseAgentEvent,
  parseAgentMessages,
} from './contract';

export interface AgentProjectionSnapshot {
  schemaVersion: 2;
  threadId: string;
  runId: string;
  status:
    | 'idle'
    | 'running'
    | 'succeeded'
    | 'cancelled'
    | 'interrupted'
    | 'failed'
    | 'unknown';
  messages: Message[];
  outputMessageIds: string[];
  warnings: string[];
  errorCode?: AgentRunFailure;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function safeActivity(
  message: Extract<Message, { role: 'activity' }>
): Message {
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

export class AgentEventProjection {
  private state: Omit<AgentProjectionSnapshot, 'outputMessageIds'>;
  private readonly openMessages = new Set<string>();
  private readonly historyIds: Set<string>;

  constructor(input: {
    threadId: string;
    runId: string;
    history?: readonly Message[];
  }) {
    this.state = {
      schemaVersion: 2,
      threadId: input.threadId,
      runId: input.runId,
      status: 'idle',
      messages: [],
      warnings: [],
    };
    this.state.messages = this.readMessages(input.history ?? []);
    this.historyIds = new Set(this.state.messages.map(message => message.id));
  }

  accept(value: unknown): void {
    const event = parseAgentEvent(value);
    const lateError =
      event?.type === EventType.RUN_ERROR &&
      ['succeeded', 'cancelled', 'interrupted'].includes(this.state.status);
    if (!['idle', 'running'].includes(this.state.status) && !lateError) {
      throw new AgentProtocolError('AGENT_RUN_NOT_ACTIVE');
    }
    if (!event) {
      if (this.state.status === 'idle') {
        throw new AgentProtocolError('AGENT_RUN_START_REQUIRED');
      }
      this.warn('unrecognized-event');
      return;
    }
    if (event.type === EventType.RUN_ERROR) {
      this.state.errorCode =
        AGENT_RUN_FAILURES.find(code => code === event.code) ??
        'AGENT_RUN_FAILED';
      this.state.status =
        !lateError && event.code === 'AGENT_STREAM_INCOMPLETE'
          ? 'unknown'
          : 'failed';
      this.openMessages.clear();
      return;
    }
    if (event.type === EventType.RUN_STARTED) {
      if (
        this.state.status !== 'idle' ||
        event.threadId !== this.state.threadId ||
        event.runId !== this.state.runId
      ) {
        throw new AgentProtocolError('AGENT_RUN_ID_MISMATCH');
      }
      if (event.protocolVersion && !/^1\.\d+$/.test(event.protocolVersion)) {
        throw new AgentProtocolError('AGENT_PROTOCOL_VERSION_UNSUPPORTED');
      }
      this.state.status = 'running';
      return;
    }
    if (this.state.status !== 'running') {
      throw new AgentProtocolError('AGENT_RUN_NOT_ACTIVE');
    }
    this.apply(event);
  }

  end(): void {
    if (this.state.status === 'idle' || this.state.status === 'running') {
      this.state.status = 'unknown';
      this.openMessages.clear();
      this.warn('stream-ended-without-terminal');
    }
  }

  snapshot(): AgentProjectionSnapshot {
    return clone({
      ...this.state,
      outputMessageIds: this.state.messages
        .filter(
          message => !this.historyIds.has(message.id) && message.role !== 'user'
        )
        .map(message => message.id),
    });
  }

  fork(): AgentEventProjection {
    const projection = new AgentEventProjection({
      threadId: this.state.threadId,
      runId: this.state.runId,
    });
    projection.state = clone(this.state);
    for (const messageId of this.openMessages)
      projection.openMessages.add(messageId);
    for (const messageId of this.historyIds)
      projection.historyIds.add(messageId);
    return projection;
  }

  private apply(event: Event): void {
    switch (event.type) {
      case EventType.TEXT_MESSAGE_START: {
        if (event.role && event.role !== 'assistant') {
          throw new AgentProtocolError('AGENT_MESSAGE_ROLE_UNSUPPORTED');
        }
        if (this.openMessages.has(event.messageId)) {
          throw new AgentProtocolError('AGENT_MESSAGE_ALREADY_EXISTS');
        }
        const existing = this.state.messages.find(
          message => message.id === event.messageId
        );
        if (existing) {
          if (
            existing.role !== (event.role ?? 'assistant') ||
            typeof existing.content !== 'string' ||
            existing.subagentRunId !== event.subagentRunId ||
            ('name' in existing ? existing.name : undefined) !== event.name
          ) {
            throw new AgentProtocolError('AGENT_MESSAGE_ROLE_MISMATCH');
          }
          this.openMessages.add(event.messageId);
          break;
        }
        const messages = parseAgentMessages([
          ...this.state.messages,
          {
            id: event.messageId,
            role: event.role ?? 'assistant',
            content: '',
            ...(event.name !== undefined ? { name: event.name } : {}),
            ...(event.subagentRunId !== undefined
              ? { subagentRunId: event.subagentRunId }
              : {}),
          },
        ]);
        this.state.messages = messages;
        this.openMessages.add(event.messageId);
        break;
      }
      case EventType.TEXT_MESSAGE_CONTENT: {
        const message = this.state.messages.find(
          item => item.id === event.messageId
        );
        if (
          !message ||
          !this.openMessages.has(event.messageId) ||
          typeof message.content !== 'string'
        ) {
          throw new AgentProtocolError('AGENT_MESSAGE_NOT_OPEN');
        }
        this.state.messages = parseAgentMessages(
          this.state.messages.map(item =>
            item.id === event.messageId
              ? { ...item, content: message.content + event.delta }
              : item
          )
        );
        break;
      }
      case EventType.TEXT_MESSAGE_END:
        if (!this.openMessages.delete(event.messageId)) {
          throw new AgentProtocolError('AGENT_MESSAGE_NOT_OPEN');
        }
        break;
      case EventType.MESSAGES_SNAPSHOT: {
        const incoming = this.readMessages(event.messages);
        const byId = new Map(incoming.map(message => [message.id, message]));
        const roles = new Set(incoming.map(message => message.role));
        const previousIds = new Set(
          this.state.messages.map(message => message.id)
        );
        const messages = this.state.messages
          .filter(
            message =>
              byId.has(message.id) ||
              ((message.role === 'activity' || message.role === 'reasoning') &&
                !roles.has(message.role))
          )
          .map(message => byId.get(message.id) ?? message);
        messages.push(
          ...incoming.filter(message => !previousIds.has(message.id))
        );
        parseAgentMessages(messages);
        for (const id of this.openMessages) {
          if (
            !messages.some(
              message =>
                message.id === id &&
                message.role === 'assistant' &&
                typeof message.content === 'string'
            )
          ) {
            throw new AgentProtocolError('AGENT_SNAPSHOT_DROPPED_OPEN_MESSAGE');
          }
        }
        this.state.messages = messages;
        break;
      }
      case EventType.ACTIVITY_SNAPSHOT: {
        const existing = this.state.messages.find(
          item => item.id === event.messageId
        );
        if (existing && existing.role !== 'activity') {
          throw new AgentProtocolError('AGENT_MESSAGE_ROLE_MISMATCH');
        }
        if (existing && event.replace === false) break;
        const activity = safeActivity({
          id: event.messageId,
          role: 'activity',
          activityType: event.activityType,
          content: event.content,
        });
        if (event.activityType !== AGUI_TOOL_SUMMARY) {
          this.warn('unsupported-activity');
        }
        this.state.messages = parseAgentMessages(
          existing
            ? this.state.messages.map(item =>
                item.id === activity.id ? activity : item
              )
            : [...this.state.messages, activity]
        );
        break;
      }
      case EventType.RUN_FINISHED:
        if (
          event.threadId !== this.state.threadId ||
          event.runId !== this.state.runId ||
          this.openMessages.size > 0
        ) {
          throw new AgentProtocolError('AGENT_RUN_TERMINAL_INVALID');
        }
        this.state.status =
          event.outcome?.type === 'interrupt'
            ? 'interrupted'
            : event.outcome?.type === 'cancelled'
              ? 'cancelled'
              : 'succeeded';
        break;
      default:
        this.warn(`unsupported-event:${event.type}`);
    }
  }

  private readMessages(value: unknown): Message[] {
    return parseAgentMessages(value).map(message => {
      if (message.role === 'activity') {
        if (message.activityType !== AGUI_TOOL_SUMMARY) {
          this.warn('unsupported-activity');
        }
        return safeActivity(message);
      }
      const cloned = clone(message);
      delete cloned.metadata;
      if (Array.isArray(message.content))
        this.warn('unsupported-content-parts');
      return cloned;
    });
  }

  private warn(message: string): void {
    if (!this.state.warnings.includes(message)) {
      this.state.warnings.push(message);
      assertProjectionSize(this.state.warnings);
    }
  }
}
