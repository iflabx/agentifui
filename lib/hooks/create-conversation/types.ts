import type {
  ChatNodeEvent,
  ChatStreamCompletionData,
  ChatSubmissionAccepted,
  ChatSubmissionBinding,
  ChatViewScope,
} from '@lib/hooks/chat-interface/types';
import type { DifyChatRequestPayload } from '@lib/services/dify/types';

export type CreateConversationPayload = Omit<
  DifyChatRequestPayload,
  'response_mode' | 'conversation_id' | 'auto_generate_name'
>;

export type OnConversationDbIdCreated = (difyId: string, dbId: string) => void;

export type OnCreateConversationNodeEvent = (event: ChatNodeEvent) => void;

export interface CreateConversationResult {
  tempConvId: string;
  realConvId?: string;
  taskId?: string;
  answerStream?: AsyncGenerator<string, void, undefined>;
  completionPromise?: Promise<ChatStreamCompletionData>;
  conversationPersistencePromise?: Promise<string | null>;
  getBinding?: () => ChatSubmissionBinding;
  error?: Error;
}

export interface UseCreateConversationReturn {
  initiateNewConversation: (
    payload: CreateConversationPayload,
    appId: string,
    userIdentifier: string,
    onDbIdCreated?: OnConversationDbIdCreated,
    onNodeEvent?: OnCreateConversationNodeEvent,
    viewScope?: ChatViewScope,
    onAccepted?: (accepted: ChatSubmissionAccepted) => void
  ) => Promise<CreateConversationResult>;
  isLoading: boolean;
  error: Error | null;
}
