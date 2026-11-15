import {
  AgentEventProjection,
  type AgentProjectionSnapshot,
  type Event,
  EventType,
  type Message,
} from '@agentifui/shared';

import type { AgentClientEvent } from '../agent-run-execution';
import type { AgentRunRecord } from '../agent-runs-repository';
import { LangChainEventBridge } from './langchain-prototype';
import { assertAgentResultBudget } from './runtime-result';

export class LangChainRunOutput {
  private readonly bridge: LangChainEventBridge;
  private projection: AgentEventProjection;
  private readonly openMessages = new Set<string>();
  private rejectedOutput = false;

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
    this.bridge = new LangChainEventBridge(context);
    this.projection = new AgentEventProjection(context);
    assertAgentResultBudget(this.projection.snapshot());
    this.accept({
      type: 'accepted',
      conversationId: run.conversation_id,
      runId: run.id,
      userMessageId: run.user_message_id,
    });
  }

  accept(event: AgentClientEvent): void {
    if (this.rejectedOutput && event.type === 'status') {
      const terminal: Event[] = [
        ...[...this.openMessages].map(messageId => ({
          type: EventType.TEXT_MESSAGE_END as const,
          messageId,
        })),
        {
          type: EventType.RUN_ERROR,
          code: 'AGENT_STREAM_INCOMPLETE',
          message: 'Agent execution failed.',
        },
      ];
      for (const output of terminal) {
        this.projection.accept(output);
        this.sink(output);
      }
      this.openMessages.clear();
      return;
    }
    let events: Event[];
    try {
      events = this.bridge.accept(event);
      const candidate = this.projection.fork();
      for (const output of events) candidate.accept(output);
      if (event.type !== 'status')
        assertAgentResultBudget(candidate.snapshot());
      this.projection = candidate;
    } catch (error) {
      this.rejectedOutput = true;
      throw error;
    }
    for (const output of events) {
      if (output.type === EventType.TEXT_MESSAGE_START)
        this.openMessages.add(output.messageId);
      if (output.type === EventType.TEXT_MESSAGE_END)
        this.openMessages.delete(output.messageId);
      this.sink(output);
    }
  }

  snapshot(): AgentProjectionSnapshot {
    return this.projection.snapshot();
  }
}
