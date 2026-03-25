import type { CombinedConversation } from '@lib/hooks/use-combined-conversations';
import type { RecentTaskExecution } from '@lib/hooks/use-recent-task-executions';

export type SidebarRecentItem = CombinedConversation | RecentTaskExecution;

export function isRecentTaskExecution(
  item: SidebarRecentItem
): item is RecentTaskExecution {
  return 'kind' in item && item.kind === 'execution';
}

export function getDisplayConversations(
  isLoadingConversations: boolean,
  conversations: CombinedConversation[],
  prevLoadedConversations: CombinedConversation[]
) {
  return isLoadingConversations &&
    conversations.length === 0 &&
    prevLoadedConversations.length > 0
    ? prevLoadedConversations
    : conversations;
}

export function getPendingChats(conversations: CombinedConversation[]) {
  return conversations.filter(chat => chat.isPending === true);
}

export function getUnpinnedChats(conversations: CombinedConversation[]) {
  return conversations.filter(chat => !chat.isPending);
}

export function getSavedRecentItems(
  visibleUnpinnedChats: CombinedConversation[],
  recentTaskExecutions: RecentTaskExecution[]
): SidebarRecentItem[] {
  return [...visibleUnpinnedChats, ...recentTaskExecutions]
    .sort((left, right) => {
      const leftTime = new Date(left.updated_at).getTime();
      const rightTime = new Date(right.updated_at).getTime();
      return rightTime - leftTime;
    })
    .slice(0, 20);
}

export function shouldUseTypewriter(item: SidebarRecentItem) {
  return (
    !isRecentTaskExecution(item) &&
    item.isPending &&
    item.titleTypewriterState?.shouldStartTyping &&
    item.titleTypewriterState?.targetTitle
  );
}

export function isPendingConversationLoading(chat: CombinedConversation) {
  return (
    chat.pendingStatus === 'creating' ||
    chat.pendingStatus === 'title_fetching' ||
    chat.pendingStatus === 'streaming_message'
  );
}

export function getMoreActionsOpacityClass(
  openDropdownId: string | null,
  itemId: string,
  itemIsLoading: boolean
) {
  if (itemIsLoading) {
    return 'pointer-events-none';
  }

  if (openDropdownId === itemId) {
    return 'opacity-100';
  }

  if (openDropdownId) {
    return 'opacity-0';
  }

  return 'opacity-0 group-hover:opacity-100 focus-within:opacity-100';
}
