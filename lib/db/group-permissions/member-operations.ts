import { type Result, failure, success } from '@lib/types/result';

import { escapeLike, mapGroupMemberRow } from './helpers';
import { callInternalDataAction, queryWithPool } from './shared';
import { type GroupMember, IS_BROWSER, type SearchableUser } from './types';

export async function getGroupMembers(
  groupId: string
): Promise<Result<GroupMember[]>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.getGroupMembers', { groupId });
  }

  try {
    const rows = await queryWithPool<Record<string, unknown>>(
      `
        SELECT
          gm.id::text,
          gm.group_id::text,
          gm.user_id::text,
          gm.created_at::text,
          p.id::text AS profile_id,
          p.username AS profile_username,
          p.full_name AS profile_full_name,
          p.email AS profile_email
        FROM group_members gm
        LEFT JOIN profiles p ON p.id = gm.user_id
        WHERE gm.group_id = $1::uuid
        ORDER BY gm.created_at DESC
      `,
      [groupId]
    );

    return success(rows.map(mapGroupMemberRow));
  } catch (error) {
    console.error('Exception while getting group members:', error);
    return failure(new Error('Failed to get group members'));
  }
}

export async function addGroupMember(
  groupId: string,
  userId: string
): Promise<Result<GroupMember>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.addGroupMember', { groupId, userId });
  }

  try {
    const rows = await queryWithPool<Record<string, unknown>>(
      `
        WITH inserted AS (
          INSERT INTO group_members (group_id, user_id)
          VALUES ($1::uuid, $2::uuid)
          RETURNING id, group_id, user_id, created_at
        )
        SELECT
          i.id::text,
          i.group_id::text,
          i.user_id::text,
          i.created_at::text,
          p.id::text AS profile_id,
          p.username AS profile_username,
          p.full_name AS profile_full_name,
          p.email AS profile_email
        FROM inserted i
        LEFT JOIN profiles p ON p.id = i.user_id
      `,
      [groupId, userId]
    );

    return success(mapGroupMemberRow(rows[0]));
  } catch (error) {
    console.error('Exception while adding group member:', error);
    return failure(new Error('Failed to add group member'));
  }
}

export async function removeGroupMember(
  groupId: string,
  userId: string
): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.removeGroupMember', {
      groupId,
      userId,
    });
  }

  try {
    await queryWithPool(
      `
        DELETE FROM group_members
        WHERE group_id = $1::uuid
          AND user_id = $2::uuid
      `,
      [groupId, userId]
    );
    return success(undefined);
  } catch (error) {
    console.error('Exception while removing group member:', error);
    return failure(new Error('Failed to remove group member'));
  }
}

export async function searchUsersForGroup(
  searchTerm: string,
  excludeUserIds: string[] = []
): Promise<Result<SearchableUser[]>> {
  if (IS_BROWSER) {
    return callInternalDataAction('groups.searchUsersForGroup', {
      searchTerm,
      excludeUserIds,
    });
  }

  try {
    const params: unknown[] = [];
    const clauses: string[] = [`status = 'active'`];

    if (excludeUserIds.length > 0) {
      params.push(excludeUserIds);
      clauses.push(`id <> ALL($${params.length}::uuid[])`);
    }

    if (searchTerm.trim()) {
      params.push(`%${escapeLike(searchTerm.trim())}%`);
      clauses.push(
        `(username ILIKE $${params.length} ESCAPE '\\' OR full_name ILIKE $${params.length} ESCAPE '\\' OR email ILIKE $${params.length} ESCAPE '\\')`
      );
    }

    const rows = await queryWithPool<SearchableUser>(
      `
        SELECT id::text, username, full_name, email, avatar_url, role::text, status::text
        FROM profiles
        WHERE ${clauses.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT 20
      `,
      params
    );

    return success(rows || []);
  } catch (error) {
    console.error('Exception while searching users:', error);
    return failure(new Error('Failed to search users'));
  }
}
