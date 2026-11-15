import { EventType, PROTOCOL_VERSION } from '@ag-ui/core';
import type { Event, Message, RunAgentInput } from '@ag-ui/core';
import {
  EventSchema,
  MessageSchema,
  RunAgentInputSchema,
} from '@ag-ui/core/schemas';

export { EventType };
export type { Event, Message, RunAgentInput };

export const AGUI_PROTOCOL_VERSION = PROTOCOL_VERSION;
export const AGUI_TOOL_SUMMARY = 'agentifui.tool-summary.v1';
export const MAX_PROJECTION_BYTES = 512 * 1024;
export const MAX_PROJECTION_MESSAGES = 256;

export class AgentProtocolError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'AgentProtocolError';
  }
}

export interface AgentRunContext {
  threadId: string;
  runId: string;
  submissionId: string;
  userMessageId: string;
  history?: readonly Message[];
}

export interface AgentToolSummary {
  name: string;
  status: 'running' | 'completed';
  parentMessageId?: string;
}

export const AGENT_RUN_FAILURES = [
  'AGENT_RUN_FAILED',
  'AGENT_STREAM_INCOMPLETE',
  'AGENT_PROTOCOL_ERROR',
  'AGENT_PARTIAL_RESULT',
  'AGENT_INTERRUPTED_UNSUPPORTED',
] as const;

export type AgentRunFailure = (typeof AGENT_RUN_FAILURES)[number];

const eventTypes = new Set<string>(Object.values(EventType));

export function parseAgentEvent(value: unknown): Event | undefined {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof (value as { type?: unknown }).type !== 'string'
  ) {
    throw new AgentProtocolError('AGENT_EVENT_INVALID');
  }
  if (!eventTypes.has((value as { type: string }).type)) return undefined;
  const parsed = EventSchema.safeParse(value);
  if (!parsed.success) throw new AgentProtocolError('AGENT_EVENT_INVALID');
  return parsed.data as Event;
}

export function parseAgentMessages(values: unknown): Message[] {
  if (!Array.isArray(values) || values.length > MAX_PROJECTION_MESSAGES) {
    throw new AgentProtocolError('AGENT_MESSAGES_INVALID');
  }
  const ids = new Set<string>();
  const messages = values.map(value => {
    const parsed = MessageSchema.safeParse(value);
    if (!parsed.success || ids.has(parsed.data.id)) {
      throw new AgentProtocolError('AGENT_MESSAGES_INVALID');
    }
    ids.add(parsed.data.id);
    return parsed.data as Message;
  });
  assertProjectionSize(messages);
  return messages;
}

export function parseAgentRunInput(value: unknown): RunAgentInput {
  const parsed = RunAgentInputSchema.safeParse(value);
  if (!parsed.success) throw new AgentProtocolError('AGENT_INPUT_INVALID');
  assertProjectionSize(parsed.data);
  parseAgentMessages(parsed.data.messages);
  return parsed.data as RunAgentInput;
}

export function assertProjectionSize(value: unknown): void {
  const encoded = JSON.stringify(value);
  if (
    encoded === undefined ||
    new TextEncoder().encode(encoded).byteLength > MAX_PROJECTION_BYTES
  ) {
    throw new AgentProtocolError('AGENT_PROJECTION_LIMIT');
  }
}
