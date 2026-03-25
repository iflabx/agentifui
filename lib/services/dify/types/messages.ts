import type { DifyRetrieverResource } from './shared';

export interface DifyMessageFile {
  id: string;
  type: string;
  url: string;
  belongs_to: 'user' | 'assistant';
}

export interface DifyMessageFeedback {
  rating: 'like' | 'dislike' | null;
}

export interface ConversationMessage {
  id: string;
  conversation_id: string;
  inputs: Record<string, unknown>;
  query: string;
  answer: string;
  message_files: DifyMessageFile[];
  created_at: number;
  feedback: DifyMessageFeedback | null;
  retriever_resources: DifyRetrieverResource[];
}

export interface GetMessagesParams {
  conversation_id: string;
  user: string;
  first_id?: string | null;
  limit?: number;
}

export interface GetMessagesResponse {
  data: ConversationMessage[];
  has_more: boolean;
  limit: number;
}

export interface DifyMessageFeedbackRequestPayload {
  rating: 'like' | 'dislike' | null;
  user: string;
  content?: string;
}

export interface DifyMessageFeedbackResponse {
  result: 'success';
}
