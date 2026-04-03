import type {
  DifyRetrieverResource,
  DifySseIterationCompletedEvent,
  DifySseIterationNextEvent,
  DifySseIterationStartedEvent,
  DifySseLoopCompletedEvent,
  DifySseLoopNextEvent,
  DifySseLoopStartedEvent,
  DifySseNodeFinishedEvent,
  DifySseNodeStartedEvent,
  DifySseParallelBranchFinishedEvent,
  DifySseParallelBranchStartedEvent,
  DifyUsage,
} from '@lib/services/dify/types';

export type ChatNodeEvent =
  | DifySseNodeStartedEvent
  | DifySseNodeFinishedEvent
  | DifySseIterationStartedEvent
  | DifySseIterationNextEvent
  | DifySseIterationCompletedEvent
  | DifySseParallelBranchStartedEvent
  | DifySseParallelBranchFinishedEvent
  | DifySseLoopStartedEvent
  | DifySseLoopNextEvent
  | DifySseLoopCompletedEvent;

export interface ChatSubmitResult {
  ok: boolean;
  surfaced?: boolean;
  errorMessage?: string;
  errorCode?: string;
  requestId?: string;
}

export interface ChatStreamCompletionData {
  messageId?: string;
  userMessageFileIds?: string[];
  usage?: DifyUsage;
  metadata?: Record<string, unknown>;
  retrieverResources?: DifyRetrieverResource[];
}

export interface DifyLocalFile {
  type: 'document';
  transfer_method: 'local_file';
  upload_file_id: string;
}

export interface ChatAnswerStreamResult {
  assistantMessageId: string | null;
  assistantText: string;
}

export interface AssistantMessagePersistenceFallback {
  id?: string | null;
  text: string;
  metadata?: Record<string, unknown>;
  tokenCount?: number;
  wasManuallyStopped?: boolean;
}

export interface ChatStreamingCheckSnapshot {
  messageId: string;
  content: string;
  lastUpdateTime: number;
}
