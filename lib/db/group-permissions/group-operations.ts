import { type Result, failure, success } from '@lib/types/result';

import { callInternalDataAction, queryWithPool } from './shared';
import { type Group, IS_BROWSER } from './types';

export async function getGroups(): Promise<Result<Group[]>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.getGroups');
  }

  try {
    const rows = await queryWithPool<Group>(
      `
        SELECT
          g.id::text,
          g.name,
          g.description,
          COALESCE(g.created_by::text, '') AS created_by,
          g.created_at::text,
          COUNT(gm.id)::int AS member_count
        FROM groups g
        LEFT JOIN group_members gm ON gm.group_id = g.id
        GROUP BY g.id
        ORDER BY g.created_at DESC
      `
    );

    return success(rows);
  } catch (error) {
    console.error('Exception while getting group list:', error);
    return failure(new Error('Failed to get group list'));
  }
}

export async function createGroup(data: {
  name: string;
  description?: string;
}): Promise<Result<Group>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.createGroup', { data });
  }

  try {
    const rows = await queryWithPool<Group>(
      `
        INSERT INTO groups (name, description)
        VALUES ($1, $2)
        RETURNING
          id::text,
          name,
          description,
          COALESCE(created_by::text, '') AS created_by,
          created_at::text
      `,
      [data.name, data.description || null]
    );

    return success(rows[0]);
  } catch (error) {
    console.error('Exception while creating group:', error);
    return failure(new Error('Failed to create group'));
  }
}

export async function updateGroup(
  groupId: string,
  data: { name?: string; description?: string }
): Promise<Result<Group>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.updateGroup', { groupId, data });
  }

  try {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (data.name !== undefined) {
      params.push(data.name);
      updates.push(`name = $${params.length}`);
    }
    if (data.description !== undefined) {
      params.push(data.description);
      updates.push(`description = $${params.length}`);
    }

    if (updates.length === 0) {
      return failure(new Error('No fields to update'));
    }

    params.push(groupId);

    const rows = await queryWithPool<Group>(
      `
        UPDATE groups
        SET ${updates.join(', ')}
        WHERE id = $${params.length}::uuid
        RETURNING
          id::text,
          name,
          description,
          COALESCE(created_by::text, '') AS created_by,
          created_at::text
      `,
      params
    );

    if (!rows[0]) {
      return failure(new Error('Group not found'));
    }

    return success(rows[0]);
  } catch (error) {
    console.error('Exception while updating group:', error);
    return failure(new Error('Failed to update group'));
  }
}

export async function deleteGroup(groupId: string): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.deleteGroup', { groupId });
  }

  try {
    await queryWithPool(`DELETE FROM groups WHERE id = $1::uuid`, [groupId]);
    return success(undefined);
  } catch (error) {
    console.error('Exception while deleting group:', error);
    return failure(new Error('Failed to delete group'));
  }
}
