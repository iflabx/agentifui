import {
  AgentEventProjection,
  type AgentProjectionSnapshot,
  AgentProtocolError,
  EventType,
  type Message,
  parseAgentEvent,
} from '../../../packages/shared/src/agui';
import { readAgentRequestError } from './langchain-api';

export interface AgentAcceptance {
  conversationId: string;
  runId: string;
  userMessageId: string;
}

export async function consumeAguiStream(
  response: Response,
  input: {
    submissionId: string;
    conversationId?: string;
    history: (acceptance: AgentAcceptance) => Message[];
    accept: (
      snapshot: AgentProjectionSnapshot,
      acceptance: AgentAcceptance
    ) => void;
  }
): Promise<void> {
  if (!response.ok) throw await readAgentRequestError(response);
  if (
    response.headers.get('x-agentifui-protocol') !== 'ag-ui/1.0' ||
    !response.body
  )
    throw new AgentProtocolError('AGENT_PROTOCOL_UNSUPPORTED');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let projection: AgentEventProjection | undefined;
  let acceptance: AgentAcceptance | undefined;
  const loadedMessageIds = new Set<string>();
  const historicalMessageIds = new Set<string>();
  let line = '';
  let data: string[] = [];
  let skipLineFeed = false;
  let frameBytes = 0;
  const publish = () => {
    if (!projection || !acceptance) return;
    const snapshot = projection.snapshot();
    const { userMessageId } = acceptance;
    const hasInput = snapshot.messages.some(
      message => message.id === userMessageId && message.role === 'user'
    );
    if (!hasInput) throw new AgentProtocolError('AGENT_RUN_INPUT_MISSING');
    input.accept(
      {
        ...snapshot,
        messages: snapshot.messages.filter(
          message =>
            !historicalMessageIds.has(message.id) ||
            loadedMessageIds.has(message.id)
        ),
        outputMessageIds: snapshot.outputMessageIds.filter(
          id => !historicalMessageIds.has(id)
        ),
      },
      acceptance
    );
  };
  const frame = () => {
    const payload = data.join('\n');
    data = [];
    frameBytes = 0;
    if (!payload) return;
    const raw: unknown = JSON.parse(payload);
    const event = parseAgentEvent(raw);
    if (!projection) {
      if (event?.type === EventType.RUN_ERROR)
        throw new AgentProtocolError(event.code || 'AGENT_RUN_FAILED');
      if (event?.type !== EventType.RUN_STARTED)
        throw new AgentProtocolError('AGENT_RUN_START_REQUIRED');
      const metadata = event.metadata?.['agentifui.acceptance.v1'] as
        Record<string, unknown> | undefined;
      if (
        !metadata ||
        metadata.submissionId !== input.submissionId ||
        typeof metadata.userMessageId !== 'string' ||
        !metadata.userMessageId ||
        (input.conversationId && event.threadId !== input.conversationId)
      )
        throw new AgentProtocolError('AGENT_RUN_ID_MISMATCH');
      acceptance = {
        conversationId: event.threadId,
        runId: event.runId,
        userMessageId: metadata.userMessageId,
      };
      const history = input.history(acceptance);
      for (const message of history) loadedMessageIds.add(message.id);
      projection = new AgentEventProjection({
        threadId: event.threadId,
        runId: event.runId,
        history,
      });
    }
    if (event?.type === EventType.MESSAGES_SNAPSHOT && acceptance) {
      const { userMessageId } = acceptance;
      const boundary = event.messages.findIndex(
        message => message.id === userMessageId && message.role === 'user'
      );
      if (boundary < 0) throw new AgentProtocolError('AGENT_RUN_INPUT_MISSING');
      for (const message of event.messages.slice(0, boundary))
        historicalMessageIds.add(message.id);
    }
    projection.accept(raw);
    publish();
  };
  const text = (value: string) => {
    for (const character of value) {
      if (skipLineFeed) {
        skipLineFeed = false;
        if (character === '\n') continue;
      }
      if (character === '\r' || character === '\n') {
        if (!line) frame();
        else if (line.startsWith('data:'))
          data.push(line.slice(5).replace(/^ /, ''));
        line = '';
        skipLineFeed = character === '\r';
      } else {
        line += character;
        frameBytes += new TextEncoder().encode(character).byteLength;
        if (frameBytes > 512 * 1024)
          throw new AgentProtocolError('AGENT_STREAM_LIMIT');
      }
    }
  };
  try {
    while (true) {
      const chunk = await reader.read();
      text(decoder.decode(chunk.value, { stream: !chunk.done }));
      if (chunk.done) break;
    }
    if (line || data.length)
      throw new AgentProtocolError('AGENT_STREAM_INCOMPLETE');
    if (!projection) throw new AgentProtocolError('AGENT_RUN_START_REQUIRED');
    projection.end();
    publish();
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
