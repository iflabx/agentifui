export const pendingDrafts = new Set<string>();
export const appDrafts = new Map<string, string>();
export const acceptedDrafts = new Map<string, string>();
export const chatInputNavigation = { activePathname: null as string | null };

export function clearChatInputScopeCache() {
  pendingDrafts.clear();
  appDrafts.clear();
  acceptedDrafts.clear();
  chatInputNavigation.activePathname = null;
}
