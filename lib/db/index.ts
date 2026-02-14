// Import service instances for internal use
import { cacheService as cacheServiceInstance } from '@lib/services/db/cache-service';
import { realtimeService as realtimeServiceInstance } from '@lib/services/db/realtime-service';

/**
 * Database query function index
 *
 * This file exports all database query related functions.
 * You can import the required functions from this file in a unified way.
 *
 * New: Unified data service, cache service, and realtime subscription service
 * Compatibility: Retain the export of original functions, while also providing new optimized versions
 */

// Unified service exports

// Unified data service
export { dataService } from '@lib/services/db/data-service';

// Cache service
export { cacheService, CacheKeys } from '@lib/services/db/cache-service';

// Realtime subscription service
export {
  realtimeService,
  SubscriptionKeys,
  SubscriptionConfigs,
} from '@lib/services/db/realtime-service';

// Message service
export { messageService } from '@lib/services/db/message-service';
export type {
  MessagePage,
  PaginationCursor,
} from '@lib/services/db/message-service';

// Result type and error handling
export type { Result } from '@lib/types/result';
export {
  success,
  failure,
  wrapAsync,
  DatabaseError,
  NetworkError,
  ValidationError,
} from '@lib/types/result';

// Compatibility exports: retain original function interfaces
// These functions have been internally upgraded to use the new data service, but keep the same API
// API key related functions
export {
  getApiKeyByServiceInstance,
  createApiKey,
  updateApiKey,
  deleteApiKey,
  getDecryptedApiKey,
  incrementApiKeyUsage,
} from './api-keys';

// Provider related functions
export {
  getAllProviders,
  getActiveProviders,
  getProviderById,
  getProviderByName,
  getDefaultProvider,
  createProvider,
  updateProvider,
  deleteProvider,
} from './providers';

// Service instance related functions
export {
  getServiceInstancesByProvider,
  getDefaultServiceInstance,
  getServiceInstanceById,
  getServiceInstanceByInstanceId,
  createServiceInstance,
  updateServiceInstance,
  deleteServiceInstance,
  setDefaultServiceInstance,
  getAppParametersFromDb,
  updateAppParametersInDb,
} from './service-instances';

// App execution record related functions: new and legacy versions
// New optimized version (returns Result type)
export {
  getUserExecutions,
  getExecutionById,
  getExecutionByExternalId,
  createExecution,
  updateExecution,
  updateExecutionStatus,
  deleteExecution,
  getExecutionsByServiceInstance,
  getExecutionStats,
} from './app-executions';

// Legacy version (keep original API)
export {
  getUserExecutionsLegacy,
  getExecutionByIdLegacy,
} from './app-executions';

// User profile related functions: new and legacy versions
// New optimized version (returns Result type)
export {
  getCurrentUserProfile,
  getUserProfileById,
  getUserProfileByUsername,
  getAdminUsers,
  updateUserProfile,
  setUserAsAdmin,
  isUserAdmin,
} from './profiles';

// Group management related functions (planned to add)
// Temporarily get basic group info via group permissions
// Legacy version (keep original API)
export {
  getCurrentUserProfileLegacy,
  getUserProfileByIdLegacy,
  getUserProfileByUsernameLegacy,
  getAdminUsersLegacy,
  updateUserProfileLegacy,
  setUserAsAdminLegacy,
  isUserAdminLegacy,
} from './profiles';

// External identity and immutable profile attributes
export {
  getUserIdentityByIssuerSubject,
  getUserIdentitiesByUserId,
  upsertUserIdentity,
  getProfileExternalAttributes,
  upsertProfileExternalAttributes,
} from './user-identities';

// Conversation related functions
export {
  getUserConversations,
  getConversationById,
  createConversation,
  updateConversation,
  deleteConversation,
  getConversationMessages,
  addMessageToConversation,
  updateMessageStatus,
  getConversationByExternalId,
  renameConversation,
  permanentlyDeleteConversation,
  createEmptyConversation,
  updateConversationMetadata,
} from './conversations';

// Message related functions: new version provided by messageService
// Retain export of original functions for compatibility
export {
  saveMessage,
  saveMessages,
  updateMessageStatus as updateMessageStatusLegacy,
  getMessagesByConversationId,
  chatMessageToDbMessage,
  createPlaceholderAssistantMessage,
  getMessageByContentAndRole,
} from './messages';

// New advanced utility functions
/**
 * Clear all cache
 */
export function clearAllCache(): void {
  cacheServiceInstance.clear();
}

/**
 * Clear cache for a specific table
 */
export function clearTableCache(table: string): number {
  return cacheServiceInstance.deletePattern(`${table}:*`);
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
  return cacheServiceInstance.getStats();
}

/**
 * Get realtime subscription statistics
 */
export function getRealtimeStats() {
  return realtimeServiceInstance.getStats();
}

/**
 * Clean up all realtime subscriptions
 */
export function cleanupRealtimeSubscriptions(): void {
  realtimeServiceInstance.unsubscribeAll();
}

/**
 * Batch cleanup resources (cache + subscriptions)
 */
export function cleanupAllResources(): void {
  cacheServiceInstance.clear();
  realtimeServiceInstance.unsubscribeAll();
  console.log(
    '[Database Service] All cache and realtime subscriptions have been cleared'
  );
}

// Development/debug functions
/**
 * Development mode: print service status
 */
export function debugServiceStatus(): void {
  if (process.env.NODE_ENV === 'development') {
    console.group('[Database Service Status]');
    console.log('Cache stats:', getCacheStats());
    console.log('Realtime subscription stats:', getRealtimeStats());
    console.log(
      'Subscription list:',
      realtimeServiceInstance.listSubscriptions()
    );
    console.groupEnd();
  }
}
