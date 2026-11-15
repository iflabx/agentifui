import {
  AgentEventProjection,
  type AgentProjectionSnapshot,
  AgentProtocolError,
  type Event,
  EventType,
  type Message,
} from '@agentifui/shared';
import { randomUUID } from 'node:crypto';

import type { AgentRunRecord } from '../agent-runs-repository';
import { DifyEventBridge } from './dify-prototype';
import {
  assertAgentResultBudget,
  projectedAssistantMessages,
} from './runtime-result';

export class DifyRunOutput {
  private readonly bridge: DifyEventBridge;
  private projection: AgentEventProjection;
  private readonly openMessages = new Set<string>();

  constructor(
    run: AgentRunRecord,
    history: readonly Message[],
    private readonly sink: (event: Event) => void
  ) {
    const context = {
      threadId: run.conversation_id,
      runId: run.id,
      submissionId: run.submission_id,
      userMessageId: run.user_message_id,
      history,
    };
    this.projection = new AgentEventProjection(context);
    this.bridge = new DifyEventBridge({
      context,
      profile: 'chatbot',
      assistantMessageId: randomUUID(),
    });
    assertAgentResultBudget(this.projection.snapshot());
  }

  accept(event: Record<string, unknown>): void {
    this.publish(
      this.bridge
        .accept(event)
        .map(output =>
          output.type === EventType.RUN_ERROR &&
          output.code !== 'AGENT_RUN_FAILED'
            ? { ...output, code: 'AGENT_STREAM_INCOMPLETE' }
            : output
        )
    );
  }

  end(): void {
    if (!['idle', 'running'].includes(this.projection.snapshot().status))
      return;
    this.publish(
      this.bridge
        .end()
        .map(output =>
          output.type === EventType.RUN_ERROR &&
          output.code !== 'AGENT_RUN_FAILED'
            ? { ...output, code: 'AGENT_STREAM_INCOMPLETE' }
            : output
        )
    );
  }

  fail(unknown: boolean): void {
    if (!['idle', 'running'].includes(this.projection.snapshot().status))
      return;
    const events: Event[] = [
      ...[...this.openMessages].map(messageId => ({
        type: EventType.TEXT_MESSAGE_END as const,
        messageId,
      })),
      {
        type: EventType.RUN_ERROR,
        code: unknown ? 'AGENT_STREAM_INCOMPLETE' : 'AGENT_RUN_FAILED',
        message: 'Agent execution failed.',
      },
    ];
    this.publish(events, true);
  }

  snapshot(): AgentProjectionSnapshot {
    return this.projection.snapshot();
  }

  private publish(events: Event[], terminal = false): void {
    const candidate = this.projection.fork();
    for (const event of events) candidate.accept(event);
    if (!terminal) {
      const snapshot = candidate.snapshot();
      assertAgentResultBudget(snapshot);
      if (
        projectedAssistantMessages(snapshot).reduce(
          (bytes, message) =>
            bytes + Buffer.byteLength(message.content, 'utf8'),
          0
        ) >
        64 * 1024
      )
        throw new AgentProtocolError('AGENT_RESULT_LIMIT');
    }
    this.projection = candidate;
    for (const event of events) {
      if (event.type === EventType.TEXT_MESSAGE_START)
        this.openMessages.add(event.messageId);
      if (event.type === EventType.TEXT_MESSAGE_END)
        this.openMessages.delete(event.messageId);
      this.sink(event);
    }
  }
}
