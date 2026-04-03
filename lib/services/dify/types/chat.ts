import type { DifyFile, DifyRetrieverResource, DifyUsage } from './shared';

export interface DifyChatRequestPayload {
  query: string;
  inputs?: Record<string, unknown>;
  response_mode: 'streaming' | 'blocking';
  user: string;
  conversation_id?: string | null;
  files?: DifyFile[];
  auto_generate_name?: boolean;
}

export interface DifyStreamResponse {
  answerStream: AsyncGenerator<string, void, undefined>;
  getConversationId: () => string | null;
  getTaskId: () => string | null;
  completionPromise?: Promise<{
    messageId?: string;
    userMessageFileIds?: string[];
    usage?: DifyUsage;
    metadata?: Record<string, unknown>;
    retrieverResources?: DifyRetrieverResource[];
  }>;
}

export interface DifyStopTaskRequestPayload {
  user: string;
}

export interface DifyStopTaskResponse {
  result: 'success';
}
