import { useUserConversations } from './use-user-conversations';

export function useAllConversations() {
  return useUserConversations(1000);
}
