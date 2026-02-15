/**
 * Unified cache cleanup service.
 * Used to clear all related caches during login, logout, or user switching.
 */
import { clearProfileCache } from '@lib/hooks/use-profile';

function clearDifyConfigCacheClientSafe() {
  // Dify runtime config cache lives on server process; browser side only needs
  // local storage cleanup.
}

// All localStorage keys that need to be cleared
const CACHE_KEYS = {
  // User-related cache
  USER_PROFILE: 'user_profile_cache',

  // Theme-related (optionally preserved, user preference)
  THEME: 'theme',

  // Application-related cache
  LAST_USED_MODEL_APP: 'last-used-model-app-id',

  // About page config (optionally preserved, global config) - removed
  // ABOUT_PAGE_CONFIG: 'about-page-config',

  // Other keys with specific prefix to be cleared
  RESIZABLE_PANE_PREFIX: 'split-pane-',
} as const;

// Sensitive cache: contains user sensitive info, must be cleared on logout
const SENSITIVE_CACHE_KEYS = [
  CACHE_KEYS.USER_PROFILE,
  CACHE_KEYS.LAST_USED_MODEL_APP,
];

// User-specific cache: bound to a specific user, should be cleared on user switch
const USER_SPECIFIC_CACHE_KEYS = [
  CACHE_KEYS.USER_PROFILE,
  CACHE_KEYS.LAST_USED_MODEL_APP,
];

// Global config cache: can be preserved across users
const GLOBAL_CONFIG_CACHE_KEYS = [
  CACHE_KEYS.THEME,
  // CACHE_KEYS.ABOUT_PAGE_CONFIG, // removed
];

// Cache to be cleared on logout
// Merge sensitive and user-specific cache
// const LOGOUT_CLEANUP_KEYS = [
//   ...new Set([...SENSITIVE_CACHE_KEYS, ...USER_SPECIFIC_CACHE_KEYS]),
// ];

/**
 * Clear sensitive cache.
 * Used on logout to clear all caches containing sensitive user information.
 */
export const clearSensitiveCache = (): void => {
  console.log('[Cache Cleanup] Start clearing sensitive cache');

  try {
    // Clear user profile cache
    clearProfileCache();

    // Clear Dify config cache
    clearDifyConfigCacheClientSafe();

    // Clear other sensitive localStorage items
    SENSITIVE_CACHE_KEYS.forEach(key => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(key);
        console.log(`[Cache Cleanup] Cleared sensitive cache: ${key}`);
      }
    });

    // Clear caches with specific prefix (e.g., resizable pane positions)
    if (typeof window !== 'undefined') {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith(CACHE_KEYS.RESIZABLE_PANE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach(key => {
        localStorage.removeItem(key);
        console.log(`[Cache Cleanup] Cleared UI cache: ${key}`);
      });
    }

    // Clear Zustand persistent storage
    clearZustandCache();

    console.log('[Cache Cleanup] Sensitive cache cleanup completed');
  } catch (error) {
    console.error('[Cache Cleanup] Sensitive cache cleanup failed:', error);
  }
};

/**
 * Clear user-specific cache.
 * Used when switching users to clear caches related to the specific user.
 */
export const clearUserSpecificCache = (): void => {
  console.log('[Cache Cleanup] Start clearing user-specific cache');

  try {
    // Clear user profile cache
    clearProfileCache();

    // Clear Dify config cache
    clearDifyConfigCacheClientSafe();

    // Clear user-specific localStorage items
    USER_SPECIFIC_CACHE_KEYS.forEach(key => {
      if (typeof window !== 'undefined') {
        localStorage.removeItem(key);
        console.log(`[Cache Cleanup] Cleared user cache: ${key}`);
      }
    });

    // Clear user-related data in Zustand persistent storage
    clearZustandUserCache();

    console.log('[Cache Cleanup] User-specific cache cleanup completed');
  } catch (error) {
    console.error('[Cache Cleanup] User-specific cache cleanup failed:', error);
  }
};

/**
 * Clear all cache.
 * Used for system reset or full cleanup.
 */
export const clearAllCache = (): void => {
  console.log('[Cache Cleanup] Start clearing all cache');

  try {
    // Clear user profile cache
    clearProfileCache();

    // Clear Dify config cache
    clearDifyConfigCacheClientSafe();

    // Clear all localStorage (except for critical system config)
    if (typeof window !== 'undefined') {
      const keysToPreserve = new Set<string>();

      // Optionally: preserve theme setting
      const preserveTheme = true;
      if (preserveTheme && localStorage.getItem(CACHE_KEYS.THEME)) {
        keysToPreserve.add(CACHE_KEYS.THEME);
      }

      // Backup data to be preserved
      const preservedData: Record<string, string> = {};
      keysToPreserve.forEach(key => {
        const value = localStorage.getItem(key);
        if (value) {
          preservedData[key] = value;
        }
      });

      // Clear all localStorage
      localStorage.clear();

      // Restore preserved data
      Object.entries(preservedData).forEach(([key, value]) => {
        localStorage.setItem(key, value);
        console.log(`[Cache Cleanup] Restored preserved item: ${key}`);
      });
    }

    // Clear all Zustand persistent storage
    clearZustandCache();

    console.log('[Cache Cleanup] All cache cleanup completed');
  } catch (error) {
    console.error('[Cache Cleanup] Full cache cleanup failed:', error);
  }
};

/**
 * Clear Zustand persistent storage.
 */
const clearZustandCache = (): void => {
  try {
    if (typeof window === 'undefined') return;

    // Clear favorite apps storage
    localStorage.removeItem('favorite-apps-storage');

    // Clear current app storage
    localStorage.removeItem('current-app-storage');

    // Clear file preview cache storage
    localStorage.removeItem('file-preview-cache-storage');

    // Clear other Zustand storage (if any)
    const zustandKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.includes('-storage') || key?.includes('-store')) {
        zustandKeys.push(key);
      }
    }

    zustandKeys.forEach(key => {
      localStorage.removeItem(key);
      console.log(`[Cache Cleanup] Cleared Zustand storage: ${key}`);
    });
  } catch (error) {
    console.warn('[Cache Cleanup] Zustand cache cleanup failed:', error);
  }
};

/**
 * Clear user-related cache in Zustand.
 */
const clearZustandUserCache = (): void => {
  try {
    if (typeof window === 'undefined') return;

    // Clear favorite apps storage (user-related)
    localStorage.removeItem('favorite-apps-storage');

    // Clear current app storage (user-related)
    localStorage.removeItem('current-app-storage');

    // Clear file preview cache storage (user-related)
    localStorage.removeItem('file-preview-cache-storage');

    console.log('[Cache Cleanup] Zustand user cache cleanup completed');
  } catch (error) {
    console.warn('[Cache Cleanup] Zustand user cache cleanup failed:', error);
  }
};

/**
 * Clear previous user's cache on login.
 */
export const clearCacheOnLogin = (): void => {
  console.log('[Cache Cleanup] Clear cache on login');
  clearUserSpecificCache();
};

/**
 * Clear sensitive cache on logout.
 */
export const clearCacheOnLogout = (): void => {
  console.log('[Cache Cleanup] Clear cache on logout');
  clearSensitiveCache();
};

/**
 * Get cache cleanup status report.
 */
export const getCacheCleanupReport = (): {
  sensitiveKeys: string[];
  userSpecificKeys: string[];
  globalConfigKeys: string[];
  currentCacheSize: number;
} => {
  let currentCacheSize = 0;

  if (typeof window !== 'undefined') {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key || '');
      if (key && value) {
        currentCacheSize += key.length + value.length;
      }
    }
  }

  return {
    sensitiveKeys: SENSITIVE_CACHE_KEYS,
    userSpecificKeys: USER_SPECIFIC_CACHE_KEYS,
    globalConfigKeys: GLOBAL_CONFIG_CACHE_KEYS,
    currentCacheSize,
  };
};
