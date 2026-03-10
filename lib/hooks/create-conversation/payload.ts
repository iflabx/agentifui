import type { DifyChatRequestPayload } from '@lib/services/dify/types';

import type { CreateConversationPayload } from './types';

export function buildTempConversationId(): string {
  return `temp-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export function buildStreamingConversationPayload(
  payloadData: CreateConversationPayload,
  userIdentifier: string
): DifyChatRequestPayload {
  return {
    ...payloadData,
    user: userIdentifier,
    response_mode: 'streaming',
    conversation_id: null,
    auto_generate_name: false,
  };
}
