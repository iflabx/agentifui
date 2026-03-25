import type { DifyCompletionStreamResponse } from '@lib/services/dify/types';

export type CompletionFinalResult = Awaited<
  DifyCompletionStreamResponse['completionPromise']
> & {
  error?: string;
  created_at?: number | null;
  conversation_id?: string | null;
  elapsed_time?: number | null;
};
