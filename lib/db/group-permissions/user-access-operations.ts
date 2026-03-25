import { type Result, failure, success } from '@lib/types/result';

import {
  type IncrementAppUsageResult,
  queryRowsWithActorContext,
} from './shared';
import { callInternalDataAction } from './shared';
import {
  type AppPermissionCheck,
  IS_BROWSER,
  type UserAccessibleApp,
} from './types';

export async function getUserAccessibleApps(
  userId: string,
  actorUserId?: string
): Promise<Result<UserAccessibleApp[]>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.getUserAccessibleApps', { userId });
  }

  try {
    const rows = await queryRowsWithActorContext<UserAccessibleApp>(
      actorUserId || userId,
      `SELECT * FROM get_user_accessible_apps($1::uuid)`,
      [userId]
    );
    return success(rows || []);
  } catch (error) {
    console.error('Exception while getting user accessible apps:', error);
    return failure(new Error('Failed to get accessible apps'));
  }
}

export async function checkUserAppPermission(
  userId: string,
  serviceInstanceId: string,
  actorUserId?: string
): Promise<Result<AppPermissionCheck>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.checkUserAppPermission', {
      userId,
      serviceInstanceId,
    });
  }

  try {
    const rows = await queryRowsWithActorContext<AppPermissionCheck>(
      actorUserId || userId,
      `
        SELECT
          has_access,
          quota_remaining,
          error_message
        FROM check_user_app_permission($1::uuid, $2::uuid)
        LIMIT 1
      `,
      [userId, serviceInstanceId]
    );

    const result = rows[0];
    if (!result) {
      return success({
        has_access: false,
        quota_remaining: null,
        error_message: 'Permission check failed',
      });
    }

    return success(result);
  } catch (error) {
    console.error('Exception while checking user app permission:', error);
    return failure(new Error('Permission check failed'));
  }
}

export async function incrementAppUsage(
  userId: string,
  serviceInstanceId: string,
  increment: number = 1,
  actorUserId?: string
): Promise<Result<IncrementAppUsageResult>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.incrementAppUsage', {
      userId,
      serviceInstanceId,
      increment,
    });
  }

  try {
    const rows = await queryRowsWithActorContext<IncrementAppUsageResult>(
      actorUserId || userId,
      `SELECT * FROM increment_app_usage($1::uuid, $2::uuid, $3::integer)`,
      [userId, serviceInstanceId, increment]
    );

    return success(
      rows[0] || {
        success: false,
        new_used_count: 0,
        quota_remaining: null,
        error_message: 'Failed to update usage count',
      }
    );
  } catch (error) {
    console.error('Exception while incrementing app usage:', error);
    return failure(new Error('Failed to update usage count'));
  }
}
