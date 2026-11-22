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
  DifySseWorkflowFinishedEvent,
  DifySseWorkflowStartedEvent,
  DifyUsage,
} from '@lib/services/dify/types';
import type { EditSubmissionResult } from '@lib/types/message-edit';

export type ChatNodeEvent =
  | DifySseWorkflowStartedEvent
  | DifySseWorkflowFinishedEvent
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
  editResult?: EditSubmissionResult;
  surfaced?: boolean;
  errorMessage?: string;
  errorCode?: string;
  requestId?: string;
}

export type AssistantMessageMetadataProvider = () =>
  Record<string, unknown> | undefined;

export interface ChatStreamCompletionData {
  messageId?: string;
  userMessageFileIds?: string[];
  usage?: DifyUsage;
  metadata?: Record<string, unknown>;
  retrieverResources?: DifyRetrieverResource[];
}

export interface DifyLocalFile {
  type: 'document' | 'image' | 'audio' | 'video' | 'custom';
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
export interface ChatViewScope {
  isCurrent: () => boolean;
  isStopped?: () => boolean;
  onRouteAdopted: (pathname: string) => void;
}

export interface ChatSubmissionBinding {
  externalId: string | null;
  taskId: string | null;
  dbConversationId?: string | null;
}

export interface ChatSubmissionAccepted {
  externalId: string;
  taskId: string;
  conversationPersistencePromise?: Promise<string | null>;
}
