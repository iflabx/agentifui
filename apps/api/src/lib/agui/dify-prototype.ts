import {
  AgentEventWriter,
  AgentProtocolError,
  type AgentRunContext,
  type Event,
} from '@agentifui/shared';

type NativeRecord = Record<string, unknown>;
type FailureCode = Parameters<AgentEventWriter['fail']>[0];
type FieldCheck = (value: unknown) => boolean;

const isString: FieldCheck = value => typeof value === 'string';
const isIdentifier: FieldCheck = value =>
  typeof value === 'string' && value.length > 0 && value.length <= 255;
const isNumber: FieldCheck = value =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;
const isCount: FieldCheck = value => isNumber(value) && Number.isInteger(value);
const isRecord: FieldCheck = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

function record(value: unknown): NativeRecord {
  if (!isRecord(value)) throw new AgentProtocolError('DIFY_EVENT_INVALID');
  return value as NativeRecord;
}

function field(
  source: NativeRecord,
  name: string,
  check: FieldCheck,
  required = false
): void {
  if (source[name] === undefined && !required) return;
  if (!check(source[name])) {
    throw new AgentProtocolError('DIFY_FIELD_INVALID');
  }
}

function oneOf(...values: string[]): FieldCheck {
  return value => typeof value === 'string' && values.includes(value);
}

function validateEnvelope(event: NativeRecord): void {
  for (const name of [
    'id',
    'message_id',
    'conversation_id',
    'task_id',
    'workflow_run_id',
  ]) {
    field(event, name, isIdentifier);
  }
  field(event, 'created_at', isNumber);
}

function validateMetadata(event: NativeRecord): void {
  field(event, 'metadata', isRecord, true);
  const metadata = record(event.metadata);
  for (const source of [event, metadata]) {
    field(source, 'usage', isRecord);
    field(source, 'retriever_resources', Array.isArray);
    if (source.usage !== undefined) {
      const usage = record(source.usage);
      for (const name of [
        'prompt_tokens',
        'completion_tokens',
        'total_tokens',
      ]) {
        field(usage, name, isCount);
      }
    }
  }
}

export interface DifyEventBridgeOptions {
  context: AgentRunContext;
  profile: 'chatbot' | 'agent-chat';
  assistantMessageId: string;
}

export type DifyBridgeWarning =
  | 'DIFY_UNKNOWN_EVENT'
  | 'DIFY_UNSUPPORTED_EVENT'
  | 'DIFY_METADATA_NOT_PROJECTED'
  | 'DIFY_NODE_NOT_PROJECTED';

export class DifyEventBridge {
  private readonly writer: AgentEventWriter;
  private readonly profile: DifyEventBridgeOptions['profile'];
  private readonly assistantMessageId: string;
  private readonly warningCodes = new Set<DifyBridgeWarning>();
  private started = false;
  private closed = false;
  private unverified = false;
  private messageEnded = false;
  private nativeMessageId?: string;
  private workflowRunId?: string;
  private workflowStarted = false;
  private workflowFinished = false;
  private failedNode = false;
  private completeAnswerReceived = false;
  private replacementReceived = false;

  constructor(options: DifyEventBridgeOptions) {
    if (
      !['chatbot', 'agent-chat'].includes(options.profile) ||
      !isIdentifier(options.assistantMessageId) ||
      options.context.history?.some(
        message => message.id === options.assistantMessageId
      ) ||
      options.assistantMessageId === options.context.userMessageId
    ) {
      throw new AgentProtocolError('DIFY_CONTEXT_INVALID');
    }
    this.writer = new AgentEventWriter(options.context);
    this.profile = options.profile;
    this.assistantMessageId = options.assistantMessageId;
  }

  get warnings(): readonly DifyBridgeWarning[] {
    return [...this.warningCodes];
  }

  accept(value: unknown): Event[] {
    if (this.closed) return [];
    try {
      const event = record(value);
      field(event, 'event', isIdentifier, true);
      const known = [
        'ping',
        'message',
        'agent_message',
        'message_replace',
        'message_end',
        'workflow_started',
        'workflow_finished',
        'workflow_paused',
        'human_input_required',
        'node_started',
        'node_finished',
        'agent_thought',
        'message_file',
        'tts_message',
        'tts_message_end',
        'error',
      ].includes(event.event as string);
      if (!known) {
        this.warn('DIFY_UNKNOWN_EVENT');
        return [];
      }
      validateEnvelope(event);
      if (event.event === 'ping') return [];
      if (event.event === 'error') {
        field(event, 'code', isIdentifier, true);
        field(event, 'message', isString, true);
        field(event, 'status', isCount, true);
        return this.fail('AGENT_RUN_FAILED');
      }
      if (event.event === 'human_input_required') {
        field(event, 'workflow_run_id', isIdentifier, true);
        const data = record(event.data);
        field(data, 'form_token', value => value === null || isString(value));
        field(data, 'form_content', isString, true);
        field(data, 'expiration_time', isCount, true);
        field(data, 'inputs', Array.isArray);
        field(data, 'actions', Array.isArray);
        return this.fail('AGENT_INTERRUPTED_UNSUPPORTED');
      }
      if (event.event === 'workflow_paused') {
        field(event, 'workflow_run_id', isIdentifier, true);
        const data = record(event.data);
        field(data, 'status', oneOf('paused'), true);
        field(
          data,
          'paused_nodes',
          value =>
            Array.isArray(value) && value.every(node => isIdentifier(node))
        );
        field(
          data,
          'reasons',
          value =>
            Array.isArray(value) && value.every(reason => isRecord(reason))
        );
        return this.fail('AGENT_INTERRUPTED_UNSUPPORTED');
      }

      this.bindIdentity(event);
      switch (event.event) {
        case 'message':
        case 'agent_message':
        case 'message_replace': {
          field(event, 'answer', isString, true);
          if (!event.message_id && !event.id) {
            throw new AgentProtocolError('DIFY_MESSAGE_ID_REQUIRED');
          }
          if (event.event === 'message_replace') {
            if (this.workflowFinished || this.messageEnded) {
              throw new AgentProtocolError('DIFY_MESSAGE_ORDER_INVALID');
            }
            this.replacementReceived = true;
            return this.startAnd(() =>
              this.writer.replace(
                this.assistantMessageId,
                event.answer as string
              )
            );
          }
          if (
            this.messageEnded ||
            this.workflowFinished ||
            this.replacementReceived ||
            (event.event === 'agent_message' &&
              (this.profile !== 'agent-chat' || this.completeAnswerReceived))
          ) {
            throw new AgentProtocolError('DIFY_MESSAGE_ORDER_INVALID');
          }
          if (this.profile === 'agent-chat' && event.event === 'message') {
            if (this.completeAnswerReceived) {
              throw new AgentProtocolError('DIFY_MULTIPLE_FULL_ANSWERS');
            }
            this.completeAnswerReceived = true;
            return this.startAnd(() =>
              this.writer.replace(
                this.assistantMessageId,
                event.answer as string
              )
            );
          }
          if (!event.answer) return this.startAnd(() => []);
          return this.startAnd(() =>
            this.writer.text(this.assistantMessageId, event.answer as string)
          );
        }
        case 'message_end':
          if (!event.message_id && !event.id) {
            throw new AgentProtocolError('DIFY_MESSAGE_ID_REQUIRED');
          }
          validateMetadata(event);
          if (
            Object.keys(record(event.metadata)).length > 0 ||
            event.usage !== undefined ||
            event.retriever_resources !== undefined
          ) {
            this.warn('DIFY_METADATA_NOT_PROJECTED');
          }
          this.messageEnded = true;
          return this.startAnd(() => []);
        case 'workflow_started': {
          const data = record(event.data);
          field(event, 'workflow_run_id', isIdentifier, true);
          field(data, 'id', isIdentifier, true);
          if (data.id !== event.workflow_run_id) {
            throw new AgentProtocolError('DIFY_WORKFLOW_ID_MISMATCH');
          }
          field(data, 'workflow_id', isIdentifier);
          field(data, 'sequence_number', isCount);
          field(data, 'created_at', isNumber);
          if (this.messageEnded || this.workflowFinished) {
            throw new AgentProtocolError('DIFY_WORKFLOW_ORDER_INVALID');
          }
          this.workflowStarted = true;
          return this.startAnd(() => []);
        }
        case 'workflow_finished': {
          field(event, 'workflow_run_id', isIdentifier, true);
          const data = record(event.data);
          field(data, 'id', isIdentifier, true);
          field(data, 'workflow_id', isIdentifier);
          if (data.id !== event.workflow_run_id) {
            throw new AgentProtocolError('DIFY_WORKFLOW_ID_MISMATCH');
          }
          field(
            data,
            'status',
            oneOf('succeeded', 'failed', 'stopped', 'partial-succeeded'),
            true
          );
          field(data, 'error', value => value === null || isString(value));
          if (data.outputs !== undefined && data.outputs !== null) {
            this.warn('DIFY_METADATA_NOT_PROJECTED');
          }
          for (const name of [
            'total_steps',
            'total_tokens',
            'exceptions_count',
          ]) {
            field(data, name, value => value === null || isCount(value));
          }
          for (const name of ['created_at', 'finished_at', 'elapsed_time']) {
            field(data, name, value => value === null || isNumber(value));
          }
          if (data.status === 'failed') return this.fail('AGENT_RUN_FAILED');
          if (data.status === 'stopped') {
            return this.startAnd(() => {
              this.closed = true;
              return this.writer.finish('cancelled');
            });
          }
          if (
            data.status === 'partial-succeeded' ||
            this.failedNode ||
            data.exceptions_count
          ) {
            return this.fail('AGENT_PARTIAL_RESULT');
          }
          if (!this.workflowStarted || data.error) {
            return this.fail('AGENT_STREAM_INCOMPLETE');
          }
          this.workflowFinished = true;
          return this.startAnd(() => []);
        }
        case 'node_started':
        case 'node_finished': {
          if (this.workflowFinished) {
            throw new AgentProtocolError('DIFY_WORKFLOW_ORDER_INVALID');
          }
          field(event, 'workflow_run_id', isIdentifier, true);
          const data = record(event.data);
          field(data, 'id', isIdentifier, true);
          field(data, 'node_id', isIdentifier, true);
          field(data, 'index', isCount);
          field(
            data,
            'node_type',
            isIdentifier,
            event.event === 'node_started'
          );
          field(data, 'title', isString);
          field(data, 'inputs', value => value === null || isRecord(value));
          field(data, 'error', value => value === null || isString(value));
          for (const name of [
            'predecessor_node_id',
            'iteration_id',
            'loop_id',
          ]) {
            field(data, name, value => value === null || isIdentifier(value));
          }
          for (const name of ['created_at', 'finished_at', 'elapsed_time']) {
            field(data, name, isNumber);
          }
          if (event.event === 'node_finished') {
            field(
              data,
              'status',
              oneOf('running', 'succeeded', 'failed', 'stopped'),
              true
            );
            this.failedNode ||= data.status === 'failed';
          }
          this.warn('DIFY_NODE_NOT_PROJECTED');
          return this.startAnd(() => []);
        }
        case 'agent_thought':
          field(event, 'position', isCount, true);
          for (const name of ['thought', 'tool', 'tool_input', 'observation']) {
            field(event, name, isString, true);
          }
          field(event, 'tool_labels', isRecord);
          field(event, 'message_files', Array.isArray);
          this.warn('DIFY_UNSUPPORTED_EVENT', true);
          return [];
        case 'message_file':
          field(event, 'type', isIdentifier, true);
          field(event, 'belongs_to', oneOf('user', 'assistant'), true);
          field(event, 'url', isString, true);
          this.warn('DIFY_UNSUPPORTED_EVENT', true);
          return [];
        case 'tts_message':
        case 'tts_message_end':
          field(event, 'audio', isString, true);
          this.warn('DIFY_UNSUPPORTED_EVENT', true);
          return [];
        default:
          this.warn('DIFY_UNSUPPORTED_EVENT', true);
          return [];
      }
    } catch (error) {
      if (!(error instanceof AgentProtocolError)) throw error;
      return this.fail('AGENT_PROTOCOL_ERROR');
    }
  }

  end(): Event[] {
    if (this.closed) return [];
    if (this.unverified) return this.fail('AGENT_PROTOCOL_ERROR');
    if (
      !this.messageEnded ||
      (this.workflowRunId !== undefined && !this.workflowFinished)
    ) {
      return this.fail('AGENT_STREAM_INCOMPLETE');
    }
    this.closed = true;
    return this.writer.finish('success');
  }

  private bindIdentity(event: NativeRecord): void {
    for (const name of ['message_id', 'workflow_run_id'] as const) {
      const incoming =
        name === 'message_id' &&
        ['message', 'agent_message', 'message_replace', 'message_end'].includes(
          event.event as string
        )
          ? (event.message_id ?? event.id)
          : event[name];
      if (incoming === undefined) continue;
      const current =
        name === 'message_id' ? this.nativeMessageId : this.workflowRunId;
      if (current !== undefined && incoming !== current) {
        throw new AgentProtocolError('DIFY_IDENTITY_CHANGED');
      }
      if (name === 'message_id') this.nativeMessageId = incoming as string;
      else this.workflowRunId = incoming as string;
    }
  }

  private warn(code: DifyBridgeWarning, unverified = false): void {
    this.warningCodes.add(code);
    this.unverified ||= unverified;
  }

  private startAnd(produce: () => Event[]): Event[] {
    const opening = this.started ? [] : this.writer.start();
    this.started = true;
    try {
      return [...opening, ...produce()];
    } catch (error) {
      if (!(error instanceof AgentProtocolError)) throw error;
      return [...opening, ...this.fail('AGENT_PROTOCOL_ERROR')];
    }
  }

  private fail(code: FailureCode): Event[] {
    this.closed = true;
    return this.writer.fail(code);
  }
}
