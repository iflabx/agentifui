export function langchainConversationPath(conversation: {
  id: string;
  db_pk?: string;
  app_id?: string | null;
  metadata?: Record<string, unknown> | null;
}): string | null {
  if (
    conversation.metadata?.backend_type !== 'langchain' ||
    !conversation.app_id
  )
    return null;
  return `/apps/langchain/${encodeURIComponent(conversation.app_id)}?conversationId=${encodeURIComponent(conversation.db_pk || conversation.id)}`;
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
