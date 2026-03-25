export const CacheKeys = {
  userProfile: (userId: string) => `user:profile:${userId}`,
  userConversations: (userId: string, page: number = 0) =>
    `user:conversations:${userId}:${page}`,
  conversation: (conversationId: string) => `conversation:${conversationId}`,
  conversationMessages: (conversationId: string, page: number = 0) =>
    `conversation:messages:${conversationId}:${page}`,
  providers: () => 'providers:active',
  serviceInstances: (providerId: string) => `service:instances:${providerId}`,
  apiKey: (serviceInstanceId: string) => `api:key:${serviceInstanceId}`,
  conversationByExternalId: (externalId: string) =>
    `conversation:external:${externalId}`,
  userExecutions: (userId: string, page: number = 0) =>
    `user:executions:${userId}:${page}`,
  execution: (executionId: string) => `execution:${executionId}`,
};
