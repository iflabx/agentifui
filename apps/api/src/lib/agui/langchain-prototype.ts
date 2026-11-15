import {
  AgentEventWriter,
  AgentProtocolError,
  type AgentRunContext,
  type Event,
  EventType,
} from '@agentifui/shared';
import { createHash } from 'node:crypto';

import type { AgentClientEvent } from '../agent-run-execution';

type StatusEvent = Extract<AgentClientEvent, { type: 'status' }>;
type ToolEvent = Extract<AgentClientEvent, { type: 'tool' }>;
type ToolActivity = {
  id: string;
  name: string;
  status: ToolEvent['status'];
  parentMessageId?: string;
};

export class LangChainEventBridge {
  private readonly writer: AgentEventWriter;
  private readonly context: AgentRunContext;
  private readonly reservedIds: Set<string>;
  private readonly messages = new Set<string>();
  private readonly tools = new Map<string, ToolActivity>();
  private accepted = false;
  private terminalType?: EventType.RUN_FINISHED | EventType.RUN_ERROR;
  private persistence: StatusEvent['persistenceStatus'] = 'pending';

  constructor(context: AgentRunContext) {
    this.writer = new AgentEventWriter(context);
    this.context = { ...context, history: undefined };
    this.reservedIds = new Set([
      context.threadId,
      context.runId,
      context.submissionId,
      context.userMessageId,
      ...(context.history ?? []).map(message => message.id),
    ]);
  }

  get persistenceStatus(): StatusEvent['persistenceStatus'] {
    return this.persistence;
  }

  accept(event: AgentClientEvent): Event[] {
    if (event.runId !== undefined && event.runId !== this.context.runId) {
      this.reject();
    }
    switch (event.type) {
      case 'accepted': {
        this.checkIdentity(event);
        if (event.userMessageId !== this.context.userMessageId) this.reject();
        if (this.terminalType) this.reject();
        if (this.accepted) return [];
        const started = this.writer.start();
        this.accepted = true;
        return started;
      }
      case 'text': {
        this.requireActive();
        this.checkId(event.messageId);
        if (this.reservedIds.has(event.messageId)) this.reject();
        const events = this.writer.text(event.messageId, event.delta);
        this.messages.add(event.messageId);
        return events;
      }
      case 'tool':
        this.requireActive();
        return this.toolSummary(event);
      case 'status':
        return this.status(event);
      default:
        return this.reject();
    }
  }

  end(): Event[] {
    if (this.terminalType) return [];
    const events = this.writer.fail('AGENT_STREAM_INCOMPLETE');
    this.terminalType = EventType.RUN_ERROR;
    return events;
  }

  private status(event: StatusEvent): Event[] {
    this.checkIdentity(event);
    if (
      !['pending', 'saved', 'failed'].includes(event.persistenceStatus) ||
      ![
        'reserved',
        'submitting',
        'running',
        'success',
        'error',
        'interrupted',
        'unknown',
      ].includes(event.executionStatus)
    ) {
      this.reject();
    }
    if (this.terminalType) {
      this.persistence = event.persistenceStatus;
      return [];
    }
    if (
      !this.accepted &&
      !['error', 'interrupted', 'unknown'].includes(event.executionStatus)
    ) {
      this.reject();
    }
    let events: Event[];
    switch (event.executionStatus) {
      case 'success':
        events = this.writer.finish('success');
        this.terminalType = EventType.RUN_FINISHED;
        break;
      case 'error':
        events = this.writer.fail('AGENT_RUN_FAILED');
        this.terminalType = EventType.RUN_ERROR;
        break;
      case 'unknown':
        events = this.writer.fail('AGENT_STREAM_INCOMPLETE');
        this.terminalType = EventType.RUN_ERROR;
        break;
      case 'interrupted':
        events = this.writer.fail('AGENT_INTERRUPTED_UNSUPPORTED');
        this.terminalType = EventType.RUN_ERROR;
        break;
      default:
        events = [];
    }
    this.persistence = event.persistenceStatus;
    return events;
  }

  private toolSummary(event: ToolEvent): Event[] {
    this.checkId(event.toolCallId);
    if (
      typeof event.name !== 'string' ||
      !/^[\w .:-]{1,128}$/.test(event.name) ||
      !['running', 'completed'].includes(event.status)
    ) {
      this.reject();
    }
    const previous = this.tools.get(event.toolCallId);
    const parentMessageId =
      event.messageId && this.messages.has(event.messageId)
        ? event.messageId
        : previous?.parentMessageId;
    if (
      previous &&
      (previous.name !== event.name ||
        (previous.parentMessageId &&
          previous.parentMessageId !== parentMessageId))
    ) {
      this.reject();
    }
    if (previous?.status === 'completed' && event.status === 'running') {
      return [];
    }
    if (
      previous?.status === event.status &&
      previous.parentMessageId === parentMessageId
    ) {
      return [];
    }
    let activityId = previous?.id;
    if (!activityId) {
      const prefix =
        this.context.runId.length <= 200
          ? this.context.runId
          : createHash('sha256').update(this.context.runId).digest('hex');
      let ordinal = this.tools.size;
      do {
        activityId = `${prefix}:tool-summary:${ordinal++}`;
      } while (
        this.reservedIds.has(activityId) ||
        this.messages.has(activityId)
      );
    }
    const activity: ToolActivity = {
      id: activityId,
      name: event.name,
      status: event.status,
      ...(parentMessageId ? { parentMessageId } : {}),
    };
    const events = this.writer.toolSummary(activity.id, {
      name: activity.name,
      status: activity.status,
      ...(activity.parentMessageId
        ? { parentMessageId: activity.parentMessageId }
        : {}),
    });
    this.tools.set(event.toolCallId, activity);
    this.reservedIds.add(activity.id);
    return events;
  }

  private checkIdentity(event: {
    conversationId: string;
    runId: string;
  }): void {
    if (
      event.conversationId !== this.context.threadId ||
      event.runId !== this.context.runId
    ) {
      this.reject();
    }
  }

  private checkId(value: string): void {
    if (
      typeof value !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/.test(value)
    ) {
      this.reject();
    }
  }

  private requireActive(): void {
    if (!this.accepted || this.terminalType) this.reject();
  }

  private reject(): never {
    throw new AgentProtocolError('AGENT_PROTOCOL_ERROR');
  }
}
