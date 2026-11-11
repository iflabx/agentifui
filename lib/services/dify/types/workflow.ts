import type {
  DifySseIterationCompletedEvent,
  DifySseIterationNextEvent,
  DifySseIterationStartedEvent,
  DifySseLoopCompletedEvent,
  DifySseLoopNextEvent,
  DifySseLoopStartedEvent,
  DifySseWorkflowPausedEvent,
} from './sse';

export type DifyWorkflowStatus =
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'stopped'
  | 'partial-succeeded'
  | 'paused';

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
  status: DifyWorkflowStatus;
  outputs?: Record<string, unknown> | null;
  error?: string | null;
  elapsed_time?: number | null;
  total_tokens?: number | null;
  total_steps: number | null;
  created_at: number | null;
  finished_at: number | null;
  exceptions_count?: number;
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
  | DifySseWorkflowPausedEvent
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
  status: DifyWorkflowStatus;
  inputs: unknown;
  outputs: Record<string, unknown> | null;
  error: string | null;
  total_steps: number | null;
  total_tokens: number | null;
  created_at: number | null;
  finished_at: number | null;
  elapsed_time: number | null;
}

export type DifyWorkflowLogStatus = 'succeeded' | 'failed' | 'stopped';

export interface GetDifyWorkflowLogsParams {
  keyword?: string;
  status?: DifyWorkflowLogStatus;
  page?: number;
  limit?: number;
}

export interface DifyWorkflowLogEntry {
  id: string;
  workflow_run: {
    id: string;
    version?: string | null;
    status?: DifyWorkflowStatus | null;
    triggered_from?: string | null;
    error?: string | null;
    total_steps?: number | null;
    total_tokens?: number | null;
    created_at?: number | null;
    finished_at?: number | null;
    elapsed_time?: number | null;
    exceptions_count?: number | null;
  } | null;
  details?: unknown;
  created_from?: string | null;
  created_by_role?: string | null;
  created_by_account?: Record<string, unknown> | null;
  created_by_end_user?: Record<string, unknown> | null;
  created_at: number | null;
}

export interface GetDifyWorkflowLogsResponse {
  page: number;
  limit: number;
  total: number;
  has_more: boolean;
  data: DifyWorkflowLogEntry[];
}
