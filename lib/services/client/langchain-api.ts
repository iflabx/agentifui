import {
  type AppErrorDetail,
  AppRequestError,
  extractAppErrorDetail,
} from '@lib/errors/app-error';

import type { PublicAgentDeliverables } from '../../../packages/shared/src/agent-results';

export type {
  AgentResultArtifact as AgentDeliverableArtifact,
  AgentResultSource as AgentDeliverableSource,
  PublicAgentDeliverables as AgentDeliverables,
} from '../../../packages/shared/src/agent-results';

type AgentDeliverables = PublicAgentDeliverables;

export interface AgentConversation {
  id: string;
  title: string;
  updated_at?: string;
}

export interface AgentMessage {
  id: string;
  role: string;
  content: string;
  metadata?: Record<string, unknown>;
}

export interface AgentInputFile {
  id: string;
  name: string;
  size: number;
  type: string;
}

export interface AgentTurnInputs {
  inputs?: Record<string, string | number>;
  attachments?: { fileId: string; slotKey: string }[];
}

export function agentInputFiles(message: AgentMessage): AgentInputFile[] {
  const files = message.metadata?.input_attachments;
  if (!Array.isArray(files)) return [];
  return files.filter(
    (file): file is AgentInputFile =>
      file !== null &&
      typeof file === 'object' &&
      typeof file.id === 'string' &&
      typeof file.name === 'string' &&
      typeof file.size === 'number' &&
      typeof file.type === 'string'
  );
}

export interface AgentRun {
  id?: string;
  runId?: string;
  conversationId?: string;
  executionStatus: string;
  persistenceStatus: string;
  errorCode?: string;
  runKind?: 'turn' | 'resume';
  rootRunId?: string;
  recoveryMessages?: AgentMessage[];
  agui?: import('../../../packages/shared/src/agui').AgentProjectionSnapshot;
  deliverables?: AgentDeliverables;
  deliverablesQueryAvailable?: boolean;
}

export interface AgentDeliverablesResponse {
  runId: string;
  conversationId: string;
  deliverables: AgentDeliverables;
}

export interface AgentInteraction {
  id: string;
  originRunId: string;
  status: 'pending' | 'submitting' | 'accepted' | 'expired' | 'unknown';
  title: string;
  description: string;
  actions: ('approve' | 'reject')[];
  commentMaxLength: number;
  expiresAt: string | null;
  decision?: { action: 'approve' | 'reject'; comment: string };
  resumeRunId?: string;
}

export type AgentEvent =
  | {
      type: 'accepted';
      conversationId: string;
      runId: string;
      userMessageId: string;
    }
  | {
      type: 'text';
      messageId: string;
      delta: string;
      runId?: string;
      order?: number;
    }
  | {
      type: 'tool';
      toolCallId: string;
      name: string;
      status: string;
      summary?: string;
      runId?: string;
      messageId?: string;
      order?: number;
    }
  | ({ type: 'status' } & AgentRun);

export class AgentRequestError extends AppRequestError {
  constructor(status: number, detail?: AppErrorDetail | null) {
    super(
      detail?.userMessage || `Agent request failed (${status})`,
      status,
      detail
    );
    this.name = 'AgentRequestError';
  }
}

export async function readAgentRequestError(
  response: Response
): Promise<AgentRequestError> {
  const detail = extractAppErrorDetail(await response.json().catch(() => null));
  return new AgentRequestError(
    response.status,
    detail
      ? {
          code: detail.code,
          source: detail.source,
          severity: detail.severity,
          retryable: detail.retryable,
          userMessage: detail.userMessage,
          requestId: detail.requestId,
          occurredAt: detail.occurredAt,
        }
      : null
  );
}

export function agentPath(appId: string, suffix = ''): string {
  return `/api/internal/apps/${encodeURIComponent(appId)}/agent${suffix}`;
}

export function agentMessageFitsRequest(
  content: string,
  conversationId?: string | null,
  turnInputs?: AgentTurnInputs
) {
  const upstreamEnvelopeReserveBytes = 1024;
  const body = {
    submissionId: '00000000-0000-0000-0000-000000000000',
    content: content.trim(),
    ...(conversationId ? { conversationId } : {}),
    ...turnInputs,
  };
  return (
    body.content.length <= 16000 &&
    new TextEncoder().encode(JSON.stringify(body)).length <=
      64 * 1024 - upstreamEnvelopeReserveBytes
  );
}

export async function agentRequest<T>(
  appId: string,
  suffix: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(agentPath(appId, suffix), {
    credentials: 'same-origin',
    cache: 'no-store',
    ...init,
    signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)])
      : AbortSignal.timeout(15000),
  });
  if (!response.ok) throw await readAgentRequestError(response);
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export async function agentSubmissionRequest(
  appId: string,
  submissionId: string,
  signal?: AbortSignal
): Promise<{ runId: string | null; state: string }> {
  const response = await fetch(
    `/api/internal/apps/${encodeURIComponent(appId)}/submissions/${encodeURIComponent(submissionId)}`,
    {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    }
  );
  if (!response.ok) throw await readAgentRequestError(response);
  return response.json();
}

export async function agentArtifactRequest(
  appId: string,
  runId: string,
  artifactId: string,
  signal?: AbortSignal
): Promise<Response> {
  const response = await fetch(
    agentPath(
      appId,
      `/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}`
    ),
    {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    }
  );
  if (!response.ok) throw await readAgentRequestError(response);
  return response;
}

export async function agentDeliverablesRequest(
  appId: string,
  runId: string,
  signal?: AbortSignal
): Promise<AgentDeliverablesResponse> {
  return agentRequest<AgentDeliverablesResponse>(
    appId,
    `/runs/${encodeURIComponent(runId)}/deliverables`,
    { signal }
  );
}

function parseEvent(frame: string): AgentEvent | null {
  const data = frame
    .split('\n')
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).trimStart())
    .join('\n');
  if (!data) return null;
  const value = JSON.parse(data) as Record<string, unknown>;
  if (!['accepted', 'text', 'tool', 'status'].includes(String(value.type)))
    return null;
  if (
    value.type === 'text' &&
    (typeof value.messageId !== 'string' || typeof value.delta !== 'string')
  )
    throw new Error('Invalid agent event');
  if (
    value.type === 'accepted' &&
    ['conversationId', 'runId', 'userMessageId'].some(
      key => typeof value[key] !== 'string'
    )
  )
    throw new Error('Invalid agent event');
  return value as unknown as AgentEvent;
}

export async function consumeAgentStream(
  response: Response,
  onEvent: (event: AgentEvent) => void
): Promise<void> {
  if (!response.ok) throw await readAgentRequestError(response);
  if (!response.body) throw new Error('Agent stream unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      buffer = buffer.replace(/\r\n/g, '\n');
      if (buffer.length > 262144)
        throw new Error('Agent stream frame too large');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const event = parseEvent(buffer.slice(0, boundary));
        if (event) onEvent(event);
        buffer = buffer.slice(boundary + 2);
        boundary = buffer.indexOf('\n\n');
      }
      if (chunk.done) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export function agentRunSettled(run: AgentRun): boolean {
  return (
    [
      'success',
      'failed',
      'error',
      'timeout',
      'interrupted',
      'waiting',
      'cancelled',
    ].includes(run.executionStatus) && run.persistenceStatus === 'saved'
  );
}

export function agentRunSaved(run: AgentRun): boolean {
  return run.executionStatus === 'success' && run.persistenceStatus === 'saved';
}
