import type { ChatNodeEvent, ChatStreamCompletionData } from '@lib/hooks/chat-interface/types';
import type { DifyChatRequestPayload } from '@lib/services/dify/types';

export type CreateConversationPayload = Omit<
  DifyChatRequestPayload,
  'response_mode' | 'conversation_id' | 'auto_generate_name'
>;

export type OnConversationDbIdCreated = (
  difyId: string,
  dbId: string
) => void;

export type OnCreateConversationNodeEvent = (event: ChatNodeEvent) => void;

export interface CreateConversationResult {
  tempConvId: string;
  realConvId?: string;
  taskId?: string;
  answerStream?: AsyncGenerator<string, void, undefined>;
  completionPromise?: Promise<ChatStreamCompletionData>;
  error?: Error;
}

export interface UseCreateConversationReturn {
  initiateNewConversation: (
    payload: CreateConversationPayload,
    appId: string,
    userIdentifier: string,
    onDbIdCreated?: OnConversationDbIdCreated,
    onNodeEvent?: OnCreateConversationNodeEvent
  ) => Promise<CreateConversationResult>;
  isLoading: boolean;
  error: Error | null;
}
