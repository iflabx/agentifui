/**
 * Database query functions related to user profiles.
 *
 * This file contains all database operations related to the profiles table.
 * Updated to use the unified data service and Result type.
 */
import { getCurrentUser } from '@lib/auth/better-auth/http-client';
import { CacheKeys, cacheService } from '@lib/services/db/cache-service';
import { dataService } from '@lib/services/db/data-service';
import { SubscriptionKeys } from '@lib/services/db/realtime-service';
import { Profile } from '@lib/types/database';
import { Result, failure, success } from '@lib/types/result';

/**
 * Get the current user's profile (optimized version).
 * @returns Result of the user profile object, or null if not found.
 */
export async function getCurrentUserProfile(): Promise<Result<Profile | null>> {
  // First get the current user ID, then query the user profile.
  // Uses the new data service and cache mechanism.
  const user = await getCurrentUser();

  if (!user) {
    return success(null);
  }

  return getUserProfileById(user.id);
}

/**
 * Get user profile by ID (optimized version).
 * @param userId User ID
 * @returns Result of the user profile object, or null if not found.
 */
export async function getUserProfileById(
  userId: string
): Promise<Result<Profile | null>> {
  return dataService.findOne<Profile>(
    'profiles',
    { id: userId },
    {
      cache: true,
      cacheTTL: 10 * 60 * 1000, // 10 minutes cache
      subscribe: true,
      subscriptionKey: SubscriptionKeys.userProfile(userId),
      onUpdate: () => {
        // Clear cache when user profile is updated
        cacheService.delete(CacheKeys.userProfile(userId));
      },
    }
  );
}

/**
 * Get user profile by username (optimized version).
 * @param username Username
 * @returns Result of the user profile object, or null if not found.
 */
export async function getUserProfileByUsername(
  username: string
): Promise<Result<Profile | null>> {
  return dataService.findOne<Profile>(
    'profiles',
    { username },
    {
      cache: true,
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache
    }
  );
}

/**
 * Get all admin users (optimized version).
 * @returns Result of the admin user list.
 */
export async function getAdminUsers(): Promise<Result<Profile[]>> {
  return dataService.findMany<Profile>(
    'profiles',
    { role: 'admin' },
    { column: 'created_at', ascending: false },
    undefined,
    {
      cache: true,
      cacheTTL: 15 * 60 * 1000, // 15 minutes cache
    }
  );
}

/**
 * Update user profile (optimized version).
 * @param userId User ID
 * @param updates Fields to update
 * @returns Result of the updated user profile object, or error if update fails.
 */
export async function updateUserProfile(
  userId: string,
  updates: Partial<Omit<Profile, 'id' | 'created_at'>>
): Promise<Result<Profile>> {
  // Add automatic update timestamp
  const updateData = {
    ...updates,
    updated_at: new Date().toISOString(),
  };

  const result = await dataService.update<Profile>(
    'profiles',
    userId,
    updateData
  );

  // Clear related cache
  if (result.success) {
    cacheService.delete(CacheKeys.userProfile(userId));
    // If username is updated, also clear username-related cache
    if (updates.username) {
      cacheService.deletePattern(`profiles:*username*`);
    }
  }

  return result;
}

/**
 * Set user as admin (optimized version).
 * @param userId User ID
 * @returns Result indicating whether the operation was successful.
 */
export async function setUserAsAdmin(userId: string): Promise<Result<boolean>> {
  const result = await dataService.update<Profile>('profiles', userId, {
    role: 'admin',
    updated_at: new Date().toISOString(),
  });

  if (result.success) {
    // Clear related cache
    cacheService.delete(CacheKeys.userProfile(userId));
    cacheService.deletePattern('profiles:*role*admin*');
    return success(true);
  }

  return success(false);
}

/**
 * Check if user is admin (optimized version).
 * @param userId User ID
 * @returns Result indicating whether the user is admin.
 */
export async function isUserAdmin(userId: string): Promise<Result<boolean>> {
  const result = await dataService.findOne<Profile>(
    'profiles',
    { id: userId },
    {
      cache: true,
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache, permission check needs fresh data
    }
  );

  if (result.success && result.data) {
    return success(result.data.role === 'admin');
  }

  if (result.success && !result.data) {
    return success(false); // User does not exist, not admin
  }

  return failure(result.error || new Error('Failed to check user role'));
}

// Note: User organization-related functions have been removed, use the group system instead.
