interface ConversationRoute {
  id: string;
  db_pk?: string;
  external_id?: string | null;
  app_id?: string | null;
  interaction_protocol?: 'ag-ui/1.0' | null;
  metadata?: Record<string, unknown> | null;
}

export function agentAppPath(
  appId: string,
  config?: {
    backend_type?: unknown;
    interaction_protocol?: unknown;
    app_metadata?: { app_type?: unknown; dify_apptype?: unknown };
  } | null
): string | null {
  if (
    config?.backend_type === 'langchain' ||
    ((config?.backend_type === undefined || config.backend_type === 'dify') &&
      config?.interaction_protocol === 'ag-ui/1.0' &&
      config.app_metadata?.app_type === 'marketplace' &&
      config.app_metadata?.dify_apptype === 'chatbot')
  )
    return `/apps/agent-chat/${encodeURIComponent(appId)}`;
  return null;
}

export function agentConversationPath(
  conversation: ConversationRoute
): string | null {
  if (!conversation.app_id) return null;
  const prefix =
    conversation.interaction_protocol === 'ag-ui/1.0'
      ? 'agent-chat'
      : conversation.metadata?.backend_type === 'langchain'
        ? 'langchain'
        : null;
  if (!prefix) return null;
  return `/apps/${prefix}/${encodeURIComponent(conversation.app_id)}?conversationId=${encodeURIComponent(conversation.db_pk || conversation.id)}`;
}

export function langchainConversationPath(
  conversation: ConversationRoute
): string | null {
  return agentConversationPath(conversation);
}

export function historyConversationPath(
  id: string,
  conversations: ConversationRoute[]
): string {
  const conversation = conversations.find(
    item => item.id === id || item.db_pk === id || item.external_id === id
  );
  return (
    (conversation && agentConversationPath(conversation)) ||
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
    ['langchain', 'agent-chat'].some(
      prefix => url.pathname === `/apps/${prefix}/${encodeURIComponent(appId)}`
    ) && url.searchParams.get('conversationId') === conversationId
  );
}
