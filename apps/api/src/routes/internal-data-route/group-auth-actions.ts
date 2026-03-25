import { queryRowsWithPgUserContext } from '../../lib/pg-context';
import {
  parsePositiveInt,
  readString,
  toErrorResponse,
  toSuccessResponse,
} from './helpers';
import { type ApiActionResponse, LOCAL_GROUP_AUTH_ACTIONS } from './types';

export async function handleGroupAuthAction(
  action: string,
  payload: Record<string, unknown> | undefined,
  actorUserId: string | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_GROUP_AUTH_ACTIONS.has(action)) {
    return null;
  }

  const targetUserId = (actorUserId || readString(payload?.userId)).trim();
  if (!actorUserId || !targetUserId) {
    return toErrorResponse('Missing required fields', 400);
  }

  if (action === 'groups.getUserAccessibleApps') {
    const rows = await queryRowsWithPgUserContext<Record<string, unknown>>(
      actorUserId,
      undefined,
      `SELECT * FROM get_user_accessible_apps($1::uuid)`,
      [targetUserId]
    );
    return toSuccessResponse(rows || []);
  }

  if (action === 'groups.checkUserAppPermission') {
    const serviceInstanceId = readString(payload?.serviceInstanceId);
    if (!serviceInstanceId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgUserContext<{
      has_access: boolean;
      quota_remaining: number | null;
      error_message: string | null;
    }>(
      actorUserId,
      undefined,
      `
        SELECT
          has_access,
          quota_remaining,
          error_message
        FROM check_user_app_permission($1::uuid, $2::uuid)
        LIMIT 1
      `,
      [targetUserId, serviceInstanceId]
    );

    return toSuccessResponse(
      rows[0] || {
        has_access: false,
        quota_remaining: null,
        error_message: 'Permission check failed',
      }
    );
  }

  if (action === 'groups.incrementAppUsage') {
    const serviceInstanceId = readString(payload?.serviceInstanceId);
    const increment = Math.max(1, parsePositiveInt(payload?.increment, 1));
    if (!serviceInstanceId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgUserContext<{
      success: boolean;
      new_used_count: number;
      quota_remaining: number | null;
      error_message: string | null;
    }>(
      actorUserId,
      undefined,
      `SELECT * FROM increment_app_usage($1::uuid, $2::uuid, $3::integer)`,
      [targetUserId, serviceInstanceId, increment]
    );

    const usageResult = rows[0];
    if (!usageResult) {
      return toErrorResponse('Failed to update usage count', 500);
    }

    return toSuccessResponse(usageResult);
  }

  return null;
}
