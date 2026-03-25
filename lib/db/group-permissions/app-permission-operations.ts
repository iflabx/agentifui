import { type Result, failure, success } from '@lib/types/result';

import { mapGroupPermissionRow } from './helpers';
import { callInternalDataAction, queryWithPool } from './shared';
import { type GroupAppPermission, IS_BROWSER } from './types';

export async function getGroupAppPermissions(
  groupId: string
): Promise<Result<GroupAppPermission[]>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.getGroupAppPermissions', { groupId });
  }

  try {
    const rows = await queryWithPool<Record<string, unknown>>(
      `
        SELECT
          gap.id::text,
          gap.group_id::text,
          gap.service_instance_id::text,
          gap.is_enabled,
          gap.usage_quota,
          gap.used_count,
          gap.created_at::text,
          si.id::text AS app_id,
          si.display_name AS app_display_name,
          si.instance_id AS app_instance_id,
          si.visibility AS app_visibility
        FROM group_app_permissions gap
        LEFT JOIN service_instances si ON si.id = gap.service_instance_id
        WHERE gap.group_id = $1::uuid
        ORDER BY gap.created_at DESC
      `,
      [groupId]
    );

    return success(rows.map(mapGroupPermissionRow));
  } catch (error) {
    console.error('Exception while getting group app permissions:', error);
    return failure(new Error('Failed to get group app permissions'));
  }
}

export async function setGroupAppPermission(
  groupId: string,
  serviceInstanceId: string,
  data: {
    is_enabled: boolean;
    usage_quota?: number | null;
  }
): Promise<Result<GroupAppPermission>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.setGroupAppPermission', {
      groupId,
      serviceInstanceId,
      data,
    });
  }

  try {
    if (!data.is_enabled) {
      await queryWithPool(
        `
          DELETE FROM group_app_permissions
          WHERE group_id = $1::uuid
            AND service_instance_id = $2::uuid
        `,
        [groupId, serviceInstanceId]
      );

      return success({
        id: '',
        group_id: groupId,
        service_instance_id: serviceInstanceId,
        is_enabled: false,
        usage_quota: null,
        used_count: 0,
        created_at: new Date().toISOString(),
      });
    }

    const rows = await queryWithPool<Record<string, unknown>>(
      `
        WITH upserted AS (
          INSERT INTO group_app_permissions (
            group_id,
            service_instance_id,
            is_enabled,
            usage_quota
          )
          VALUES ($1::uuid, $2::uuid, TRUE, $3::integer)
          ON CONFLICT (group_id, service_instance_id)
          DO UPDATE
            SET is_enabled = EXCLUDED.is_enabled,
                usage_quota = EXCLUDED.usage_quota
          RETURNING *
        )
        SELECT
          u.id::text,
          u.group_id::text,
          u.service_instance_id::text,
          u.is_enabled,
          u.usage_quota,
          u.used_count,
          u.created_at::text,
          si.id::text AS app_id,
          si.display_name AS app_display_name,
          si.instance_id AS app_instance_id,
          si.visibility AS app_visibility
        FROM upserted u
        LEFT JOIN service_instances si ON si.id = u.service_instance_id
      `,
      [groupId, serviceInstanceId, data.usage_quota ?? null]
    );

    return success(mapGroupPermissionRow(rows[0]));
  } catch (error) {
    console.error('Exception while setting group app permission:', error);
    return failure(new Error('Failed to set group app permission'));
  }
}

export async function removeGroupAppPermission(
  groupId: string,
  serviceInstanceId: string
): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.removeGroupAppPermission', {
      groupId,
      serviceInstanceId,
    });
  }

  try {
    await queryWithPool(
      `
        DELETE FROM group_app_permissions
        WHERE group_id = $1::uuid
          AND service_instance_id = $2::uuid
      `,
      [groupId, serviceInstanceId]
    );
    return success(undefined);
  } catch (error) {
    console.error('Exception while deleting group app permission:', error);
    return failure(new Error('Failed to delete group app permission'));
  }
}

export async function removeAllGroupAppPermissions(
  serviceInstanceId: string
): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.removeAllGroupAppPermissions', {
      serviceInstanceId,
    });
  }

  try {
    await queryWithPool(
      `
        DELETE FROM group_app_permissions
        WHERE service_instance_id = $1::uuid
      `,
      [serviceInstanceId]
    );
    return success(undefined);
  } catch (error) {
    console.error(
      'Exception while deleting all group app permissions for app:',
      error
    );
    return failure(
      new Error('Failed to delete all group app permissions for app')
    );
  }
}
