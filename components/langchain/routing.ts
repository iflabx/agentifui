interface ConversationRoute {
  id: string;
  db_pk?: string;
  external_id?: string | null;
  app_id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function langchainConversationPath(
  conversation: ConversationRoute
): string | null {
  if (
    conversation.metadata?.backend_type !== 'langchain' ||
    !conversation.app_id
  )
    return null;
  return `/apps/langchain/${encodeURIComponent(conversation.app_id)}?conversationId=${encodeURIComponent(conversation.db_pk || conversation.id)}`;
}

export function historyConversationPath(
  id: string,
  conversations: ConversationRoute[]
): string {
  const conversation = conversations.find(
    item => (item.external_id || item.id) === id
  );
  return (
    (conversation && langchainConversationPath(conversation)) ||
    `/chat/${encodeURIComponent(id)}`
  );
}

export function isCurrentLangchainConversation(
  href: string,
  appId: string,
  conversationId: string
): boolean {
  const url = new URL(href);
  return (
    url.pathname === `/apps/langchain/${encodeURIComponent(appId)}` &&
    url.searchParams.get('conversationId') === conversationId
  );
}
