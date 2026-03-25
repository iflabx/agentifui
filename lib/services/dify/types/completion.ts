import type { DifyFile, DifyUsage } from './shared';

export interface DifyAudioToTextRequestPayload {
  file: File;
  user: string;
}

export interface DifyAudioToTextResponse {
  text: string;
}

export interface DifyCompletionRequestPayload {
  inputs: Record<string, unknown>;
  response_mode: 'streaming' | 'blocking';
  user: string;
  files?: DifyFile[];
}

export interface DifyCompletionResponse {
  message_id: string;
  mode: string;
  answer: string;
  metadata: Record<string, unknown>;
  usage: DifyUsage;
  created_at: number;
}

export interface DifyCompletionStreamResponse {
  answerStream: AsyncGenerator<string, void, undefined>;
  getMessageId: () => string | null;
  getTaskId: () => string | null;
  completionPromise: Promise<{
    usage?: DifyUsage;
    metadata?: Record<string, unknown>;
  }>;
}
