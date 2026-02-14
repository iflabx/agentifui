'use client';

import { signOutCurrentSession } from '@lib/auth/better-auth/http-client';
import { clearCacheOnLogout } from '@lib/utils/cache-cleanup';

import { useRouter } from 'next/navigation';

/**
 * Logout Hook
 *
 * Provides logout functionality and handles all related logic, including:
 * - Calling better-auth sign out method
 * - Clearing local state and sensitive cache
 * - Redirecting to the login page
 *
 * @returns An object containing the logout method
 *
 * @example
 * ```tsx
 * const { logout } = useLogout();
 *
 * return (
 *   <button
 *     onClick={logout}
 *   >
 *     Logout
 *   </button>
 * );
 * ```
 */
export function useLogout() {
  const router = useRouter();

  /**
   * Executes the logout process:
   * - Calls better-auth sign out method
   * - Clears all sensitive cache and user data
   * - Redirects to the login page
   * - Refreshes the router to update authentication state
   */
  const logout = async () => {
    try {
      console.log('[Logout] Starting logout process');

      // First, clear all sensitive cache to ensure user data safety
      clearCacheOnLogout();

      // Call better-auth sign out method
      await signOutCurrentSession();

      console.log('[Logout] better-auth sign out successful');

      // Redirect to login page
      router.push('/login');

      // Refresh the router to update authentication state
      router.refresh();

      console.log('[Logout] Logout process completed');
    } catch (error) {
      console.error('[Logout] Logout failed:', error);

      // Even if logout fails, clear local cache to ensure safety
      try {
        clearCacheOnLogout();
        console.log('[Logout] Cache cleared successfully even after failure');
      } catch (cacheError) {
        console.error('[Logout] Cache clearing also failed:', cacheError);
      }
    }
  };

  return { logout };
}
