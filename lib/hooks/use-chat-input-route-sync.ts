import { useChatInputStore } from '@lib/stores/chat-input-store';

import { useEffect } from 'react';

import { usePathname } from 'next/navigation';

/**
 * Route sync hook for chat input.
 * Automatically syncs the current route to ChatInputStore,
 * ensuring input content is isolated per route.
 */
export function useChatInputRouteSync() {
  const pathname = usePathname() ?? '';
  const setCurrentRoute = useChatInputStore(state => state.setCurrentRoute);

  useEffect(() => {
    // Update the current route in the store when the route changes
    setCurrentRoute(pathname);
  }, [pathname, setCurrentRoute]);
}
