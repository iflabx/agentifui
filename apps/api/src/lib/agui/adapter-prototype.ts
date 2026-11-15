import {
  AGUI_PROTOCOL_VERSION,
  AgentEventProjection,
  type AgentPersistenceStatus,
  type AgentProjectionSnapshot,
  AgentProtocolError,
  type AgentRunContext,
  type Event,
  EventType,
  type RunAgentInput,
  agentModelInputMessages,
  parseAgentRunInput,
  readAgentHistoryMessages,
} from '@agentifui/shared';
import { randomUUID } from 'node:crypto';

import type { AgentClientEvent } from '../agent-run-execution';
import { DifyEventBridge } from './dify-prototype';
import { LangChainEventBridge } from './langchain-prototype';

type Capability =
  'text' | 'toolSummary' | 'queryRun' | 'humanInput' | 'cancellation';
type ExecutionStatus =
  'running' | 'success' | 'error' | 'unknown' | 'interrupted' | 'cancelled';

export interface PrototypeAppDescriptor {
  appId: string;
  name: string;
  capabilities: Record<
    Capability,
    {
      declared?: boolean;
      enabled: false;
      reason: 'runtime-not-integrated';
    }
  >;
}

export interface PrototypeRunInput {
  appId: string;
  context: AgentRunContext;
  input: RunAgentInput;
}

export interface PrototypeTurn {
  threadId: string;
  runId: string;
  userMessageId: string;
  content: string;
}

export interface PrototypeRunQuery {
  appId: string;
  threadId: string;
  runId: string;
}

export type PrototypeQueryResult =
  | {
      status: 'confirmed';
      executionStatus: ExecutionStatus;
      resultComplete: boolean;
    }
  | { status: 'unsupported' | 'unknown' | 'rejected' };

export interface PrototypeExecutionResult {
  projection: AgentProjectionSnapshot;
  persistenceStatus?: AgentPersistenceStatus;
  warnings: readonly string[];
}

export interface AgentExecutionPrototype {
  describe(): PrototypeAppDescriptor;
  execute(
    request: PrototypeRunInput,
    sink: (event: Event) => void
  ): Promise<PrototypeExecutionResult>;
  queryRun(request: PrototypeRunQuery): Promise<PrototypeQueryResult>;
}

interface PrototypeOptions<TEvent> {
  appId: string;
  name: string;
  declared?: Partial<Record<Capability, boolean>>;
  stream: (turn: PrototypeTurn) => AsyncIterable<TEvent>;
  query?: (request: PrototypeRunQuery) => Promise<PrototypeQueryResult>;
}

interface Bridge<TEvent> {
  accept(event: TEvent): Event[];
  end(): Event[];
  readonly persistenceStatus?: AgentPersistenceStatus;
  readonly warnings?: readonly string[];
}

export function prototypeRunInput(context: AgentRunContext): RunAgentInput {
  return {
    protocolVersion: AGUI_PROTOCOL_VERSION,
    threadId: context.threadId,
    runId: context.runId,
    messages: agentModelInputMessages(context.history ?? []),
    tools: [],
    context: [],
  };
}

function validatedTurn(
  request: PrototypeRunInput,
  appId: string
): PrototypeTurn {
  const input = parseAgentRunInput(request.input);
  const expected = prototypeRunInput(request.context);
  if (
    request.appId !== appId ||
    input.threadId !== request.context.threadId ||
    input.runId !== request.context.runId ||
    (input.protocolVersion !== undefined &&
      input.protocolVersion !== AGUI_PROTOCOL_VERSION) ||
    input.tools.length ||
    input.context.length ||
    input.resume?.length ||
    input.parentRunId !== undefined ||
    input.forwardedProps !== undefined ||
    (input.state !== undefined && JSON.stringify(input.state) !== '{}') ||
    JSON.stringify(agentModelInputMessages(input.messages)) !==
      JSON.stringify(expected.messages)
  )
    throw new AgentProtocolError('AGENT_INPUT_INVALID');
  const message = input.messages.at(-1);
  if (
    !message ||
    message.id !== request.context.userMessageId ||
    message.role !== 'user' ||
    typeof message.content !== 'string'
  ) {
    throw new AgentProtocolError('AGENT_INPUT_INVALID');
  }
  return {
    threadId: input.threadId,
    runId: input.runId,
    userMessageId: message.id,
    content: message.content,
  };
}

function createPrototype<TEvent>(
  options: PrototypeOptions<TEvent>,
  createBridge: (context: AgentRunContext) => Bridge<TEvent>
): AgentExecutionPrototype {
  return {
    describe() {
      const capabilities = {} as PrototypeAppDescriptor['capabilities'];
      for (const capability of [
        'text',
        'toolSummary',
        'queryRun',
        'humanInput',
        'cancellation',
      ] as const) {
        capabilities[capability] = {
          ...(options.declared?.[capability] !== undefined
            ? { declared: options.declared[capability] }
            : {}),
          enabled: false,
          reason: 'runtime-not-integrated',
        };
      }
      return { appId: options.appId, name: options.name, capabilities };
    },
    async execute(request, sink) {
      const context = {
        ...request.context,
        history: readAgentHistoryMessages(request.context.history ?? []),
      };
      const turn = validatedTurn({ ...request, context }, options.appId);
      const bridge = createBridge(context);
      const projection = new AgentEventProjection(context);
      let sinkFailed = false;
      const emit = (events: Event[]) => {
        for (const event of events) {
          projection.accept(event);
          try {
            sink(event);
          } catch (error) {
            sinkFailed = true;
            throw error;
          }
        }
      };
      try {
        for await (const event of options.stream(turn))
          emit(bridge.accept(event));
        emit(bridge.end());
      } catch (error) {
        if (sinkFailed) throw error;
        const state = projection.snapshot().status;
        if (state !== 'failed' && state !== 'unknown') {
          emit([
            {
              type: EventType.RUN_ERROR,
              code:
                error instanceof AgentProtocolError
                  ? 'AGENT_PROTOCOL_ERROR'
                  : 'AGENT_STREAM_INCOMPLETE',
              message: 'Agent execution failed.',
            },
          ]);
        }
      }
      projection.end();
      return {
        projection: projection.snapshot(),
        ...(bridge.persistenceStatus !== undefined
          ? { persistenceStatus: bridge.persistenceStatus }
          : {}),
        warnings: [...(bridge.warnings ?? [])],
      };
    },
    async queryRun(request) {
      if (
        request.appId !== options.appId ||
        !request.threadId ||
        !request.runId
      )
        return { status: 'rejected' };
      if (!options.query) return { status: 'unsupported' };
      try {
        const result = await options.query({
          appId: options.appId,
          threadId: request.threadId,
          runId: request.runId,
        });
        if (result.status === 'confirmed') {
          if (
            ![
              'running',
              'success',
              'error',
              'unknown',
              'interrupted',
              'cancelled',
            ].includes(result.executionStatus) ||
            typeof result.resultComplete !== 'boolean'
          )
            return { status: 'unknown' };
          return {
            status: 'confirmed',
            executionStatus: result.executionStatus,
            resultComplete: result.resultComplete,
          };
        }
        return {
          status: ['unsupported', 'rejected'].includes(result.status)
            ? (result.status as 'unsupported' | 'rejected')
            : 'unknown',
        };
      } catch {
        return { status: 'unknown' };
      }
    },
  };
}

export function createDifyExecutionPrototype(
  options: PrototypeOptions<unknown> & {
    profile: 'chatbot' | 'agent-chat';
    assistantMessageId?: () => string;
  }
): AgentExecutionPrototype {
  return createPrototype(
    options,
    context =>
      new DifyEventBridge({
        context,
        profile: options.profile,
        assistantMessageId: options.assistantMessageId?.() ?? randomUUID(),
      })
  );
}

export function createLangChainExecutionPrototype(
  options: PrototypeOptions<AgentClientEvent>
): AgentExecutionPrototype {
  return createPrototype(options, context => new LangChainEventBridge(context));
}
