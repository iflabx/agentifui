import type {
  DifySseIterationCompletedEvent,
  DifySseIterationNextEvent,
  DifySseIterationStartedEvent,
  DifySseLoopCompletedEvent,
  DifySseLoopNextEvent,
  DifySseLoopStartedEvent,
} from './sse';

export interface DifyWorkflowInputFile {
  type: 'document' | 'image' | 'audio' | 'video' | 'custom';
  transfer_method: 'remote_url' | 'local_file';
  url?: string;
  upload_file_id?: string;
}

export interface DifyWorkflowRequestPayload {
  inputs: Record<string, unknown>;
  response_mode: 'streaming' | 'blocking';
  user: string;
}

export interface DifyWorkflowCompletionResponse {
  workflow_run_id: string;
  task_id: string;
  data: DifyWorkflowFinishedData;
}

export interface DifyWorkflowFinishedData {
  id: string;
  workflow_id: string;
  status: 'running' | 'succeeded' | 'failed' | 'stopped';
  outputs?: Record<string, unknown> | null;
  error?: string | null;
  elapsed_time?: number | null;
  total_tokens?: number | null;
  total_steps: number;
  created_at: number;
  finished_at: number;
}

export interface DifyWorkflowSseStartedEvent {
  event: 'workflow_started';
  task_id: string;
  workflow_run_id: string;
  data: {
    id: string;
    workflow_id: string;
    sequence_number: number;
    created_at: number;
  };
}

export interface DifyWorkflowSseFinishedEvent {
  event: 'workflow_finished';
  task_id: string;
  workflow_run_id: string;
  data: DifyWorkflowFinishedData;
}

export interface DifyWorkflowSseNodeStartedEvent {
  event: 'node_started';
  task_id: string;
  workflow_run_id: string;
  data: {
    id: string;
    node_id: string;
    node_type: string;
    title: string;
    index: number;
    predecessor_node_id?: string;
    inputs: Record<string, unknown>;
    created_at: number;
  };
}

export interface DifyWorkflowSseNodeFinishedEvent {
  event: 'node_finished';
  task_id: string;
  workflow_run_id: string;
  data: {
    id: string;
    node_id: string;
    index: number;
    predecessor_node_id?: string;
    inputs?: Record<string, unknown>;
    process_data?: unknown;
    outputs?: unknown;
    status: 'running' | 'succeeded' | 'failed' | 'stopped';
    error?: string;
    elapsed_time?: number;
    execution_metadata?: unknown;
    total_tokens?: number;
    total_price?: string;
    currency?: string;
    created_at: number;
  };
}

export interface DifyWorkflowSseErrorEvent {
  event: 'error';
  task_id: string;
  workflow_run_id?: string;
  status: number;
  code: string;
  message: string;
}

export type DifyWorkflowSseEvent =
  | DifyWorkflowSseStartedEvent
  | DifyWorkflowSseFinishedEvent
  | DifyWorkflowSseNodeStartedEvent
  | DifyWorkflowSseNodeFinishedEvent
  | DifyWorkflowSseErrorEvent
  | DifySseIterationStartedEvent
  | DifySseIterationNextEvent
  | DifySseIterationCompletedEvent
  | DifySseLoopStartedEvent
  | DifySseLoopNextEvent
  | DifySseLoopCompletedEvent;

export interface DifyWorkflowStreamResponse {
  progressStream: AsyncGenerator<DifyWorkflowSseEvent, void, undefined>;
  getWorkflowRunId: () => string | null;
  getTaskId: () => string | null;
  completionPromise: Promise<DifyWorkflowFinishedData>;
}

export type DifyWorkflowErrorCode =
  | 'invalid_param'
  | 'app_unavailable'
  | 'provider_not_initialize'
  | 'provider_quota_exceeded'
  | 'model_currently_not_support'
  | 'workflow_request_error';

export interface DifyWorkflowRunDetailResponse {
  id: string;
  workflow_id: string;
  status: 'running' | 'succeeded' | 'failed' | 'stopped';
  inputs: string;
  outputs: Record<string, unknown> | null;
  error: string | null;
  total_steps: number;
  total_tokens: number;
  created_at: number;
  finished_at: number | null;
  elapsed_time: number | null;
}

export type DifyWorkflowLogStatus =
  | 'succeeded'
  | 'failed'
  | 'stopped'
  | 'running';

export interface GetDifyWorkflowLogsParams {
  keyword?: string;
  status?: DifyWorkflowLogStatus;
  page?: number;
  limit?: number;
}

export interface DifyWorkflowLogEntry {
  id: string;
  workflow_id: string;
  status: DifyWorkflowLogStatus;
  inputs: string;
  outputs: Record<string, unknown> | null;
  error: string | null;
  total_steps: number;
  total_tokens: number;
  created_at: number;
  finished_at: number | null;
  elapsed_time: number | null;
}

export interface GetDifyWorkflowLogsResponse {
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
  data: DifyWorkflowLogEntry[];
}
