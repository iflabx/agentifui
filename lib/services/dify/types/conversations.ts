export interface GetConversationsParams {
  user: string;
  last_id?: string | null;
  limit?: number;
  sort_by?: 'created_at' | '-created_at' | 'updated_at' | '-updated_at';
}

export interface Conversation {
  id: string;
  name: string;
  inputs: Record<string, unknown>;
  status: string;
  introduction: string;
  created_at: number;
  updated_at: number;
}

export interface GetConversationsResponse {
  data: Conversation[];
  has_more: boolean;
  limit: number;
}

export interface DeleteConversationRequestPayload {
  user: string;
}

export interface DeleteConversationResponse {
  result: 'success';
}

export interface RenameConversationRequestPayload {
  name?: string;
  auto_generate?: boolean;
  user: string;
}

export type RenameConversationResponse = Conversation;

export interface GetConversationVariablesParams {
  user: string;
  last_id?: string | null;
  limit?: number;
}

export interface ConversationVariable {
  id: string;
  name: string;
  value_type: string;
  value: string;
  description: string;
  created_at: number;
  updated_at: number;
}

export interface GetConversationVariablesResponse {
  limit: number;
  has_more: boolean;
  data: ConversationVariable[];
}
