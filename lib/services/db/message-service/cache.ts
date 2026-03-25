import { cacheService } from '../cache-service';

export function getConversationMessagesCachePattern(conversationId: string) {
  return `conversation:messages:${conversationId}:*`;
}

export function clearConversationMessagesCache(conversationId: string): number {
  return cacheService.deletePattern(
    getConversationMessagesCachePattern(conversationId)
  );
}

export function clearAllConversationMessagesCache(): number {
  return cacheService.deletePattern('conversation:messages:*');
}

export function clearConversationMessageCaches(
  conversationIds: Iterable<string>
): void {
  for (const conversationId of conversationIds) {
    clearConversationMessagesCache(conversationId);
  }
}
