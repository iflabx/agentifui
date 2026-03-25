import type { AccountStatus, Profile, UserRole } from '@lib/types/database';
import { type Result, failure, success } from '@lib/types/result';

import { callInternalDataAction } from '../internal-data-api';
import { buildUpdateSetClause } from './query-helpers';
import {
  IS_BROWSER,
  type RealtimeRow,
  getPool,
  publishProfileChangeBestEffort,
  queryRowsWithActorContext,
} from './shared';
import type { ProfileUpdate } from './types';

type ProfileRealtimeSnapshot = {
  id: string;
  role: string | null;
  status: string | null;
  updated_at: string | null;
};

async function getProfileRealtimeSnapshot(
  userId: string,
  actorUserId?: string
): Promise<ProfileRealtimeSnapshot | null> {
  const rows = await queryRowsWithActorContext<ProfileRealtimeSnapshot>(
    actorUserId,
    `
      SELECT
        id::text AS id,
        role::text AS role,
        status::text AS status,
        updated_at::text AS updated_at
      FROM profiles
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [userId]
  );

  return rows[0] || null;
}

async function publishUpdatedRows(
  rows: Array<ProfileRealtimeSnapshot>
): Promise<void> {
  await Promise.all(
    rows.map(async row => {
      await publishProfileChangeBestEffort({
        eventType: 'UPDATE',
        oldRow: null,
        newRow: row,
      });
    })
  );
}

export async function updateUserProfile(
  userId: string,
  updates: Partial<ProfileUpdate>
): Promise<Result<Profile>> {
  if (IS_BROWSER) {
    return callInternalDataAction('users.updateUserProfile', {
      userId,
      updates,
    });
  }

  try {
    const oldProfile = await getProfileRealtimeSnapshot(userId);
    const updateData = {
      ...updates,
      updated_at: new Date().toISOString(),
    } as Record<string, unknown>;
    const setClause = buildUpdateSetClause(updateData, 1);

    if (!setClause.clause) {
      return failure(new Error('No valid fields to update'));
    }

    const pool = await getPool();
    const { rows } = await pool.query<Profile>(
      `
        UPDATE profiles
        SET ${setClause.clause}
        WHERE id = $${setClause.values.length + 1}::uuid
        RETURNING *
      `,
      [...setClause.values, userId]
    );

    const profile = rows[0];
    if (!profile) {
      return failure(new Error('User profile not found'));
    }

    await publishProfileChangeBestEffort({
      eventType: 'UPDATE',
      oldRow: oldProfile,
      newRow: profile as unknown as RealtimeRow,
    });

    return success(profile);
  } catch (error) {
    console.error('Exception while updating user profile:', error);
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to update user profile')
    );
  }
}

export async function updateUserRole(
  userId: string,
  role: UserRole
): Promise<Result<Profile>> {
  return updateUserProfile(userId, { role });
}

export async function updateUserStatus(
  userId: string,
  status: AccountStatus
): Promise<Result<Profile>> {
  return updateUserProfile(userId, { status });
}

export async function deleteUser(
  userId: string,
  actorUserId?: string
): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('users.deleteUser', { userId });
  }

  try {
    const oldProfile = await getProfileRealtimeSnapshot(userId, actorUserId);

    if (actorUserId) {
      const rows = await queryRowsWithActorContext<{ deleted: boolean }>(
        actorUserId,
        `SELECT safe_delete_user($1::uuid) AS deleted`,
        [userId]
      );
      if (!rows[0]?.deleted) {
        return failure(new Error('User not found'));
      }

      if (oldProfile) {
        await publishProfileChangeBestEffort({
          eventType: 'DELETE',
          oldRow: oldProfile,
          newRow: null,
        });
      }
      return success(undefined);
    }

    const pool = await getPool();
    const result = await pool.query<{ id: string }>(
      `DELETE FROM profiles WHERE id = $1::uuid RETURNING id::text AS id`,
      [userId]
    );

    if (!result.rowCount) {
      return failure(new Error('User not found'));
    }

    if (oldProfile) {
      await publishProfileChangeBestEffort({
        eventType: 'DELETE',
        oldRow: oldProfile,
        newRow: null,
      });
    }

    return success(undefined);
  } catch (error) {
    console.error('Exception while deleting user:', error);
    return failure(
      error instanceof Error ? error : new Error('Failed to delete user')
    );
  }
}

export async function createUserProfile(
  userId: string,
  profileData: {
    full_name?: string;
    username?: string;
    avatar_url?: string;
    role?: UserRole;
    status?: AccountStatus;
    auth_source?: string;
  }
): Promise<Result<Profile>> {
  if (IS_BROWSER) {
    return callInternalDataAction('users.createUserProfile', {
      userId,
      profileData,
    });
  }

  try {
    const pool = await getPool();
    const { rows } = await pool.query<Profile>(
      `
        INSERT INTO profiles (
          id,
          full_name,
          username,
          avatar_url,
          role,
          status,
          auth_source,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid,
          $2,
          $3,
          $4,
          COALESCE($5::user_role, 'user'),
          COALESCE($6::account_status, 'active'),
          COALESCE($7, 'password'),
          NOW(),
          NOW()
        )
        RETURNING *
      `,
      [
        userId,
        profileData.full_name || null,
        profileData.username || null,
        profileData.avatar_url || null,
        profileData.role || null,
        profileData.status || null,
        profileData.auth_source || null,
      ]
    );

    if (rows[0]) {
      await publishProfileChangeBestEffort({
        eventType: 'INSERT',
        oldRow: null,
        newRow: rows[0] as unknown as RealtimeRow,
      });
    }

    return success(rows[0]);
  } catch (error) {
    console.error('Exception while creating user profile:', error);
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to create user profile')
    );
  }
}

export async function batchUpdateUserStatus(
  userIds: string[],
  status: AccountStatus
): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('users.batchUpdateUserStatus', {
      userIds,
      status,
    });
  }

  try {
    if (userIds.length === 0) {
      return success(undefined);
    }

    const pool = await getPool();
    const updatedRows = await pool.query<ProfileRealtimeSnapshot>(
      `
        UPDATE profiles
        SET status = $2::account_status,
            updated_at = NOW()
        WHERE id = ANY($1::uuid[])
        RETURNING
          id::text AS id,
          status::text AS status,
          role::text AS role,
          updated_at::text AS updated_at
      `,
      [userIds, status]
    );

    await publishUpdatedRows(updatedRows.rows);
    return success(undefined);
  } catch (error) {
    console.error('Exception while batch updating user status:', error);
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to batch update user status')
    );
  }
}

export async function batchUpdateUserRole(
  userIds: string[],
  role: UserRole
): Promise<Result<void>> {
  if (IS_BROWSER) {
    return callInternalDataAction('users.batchUpdateUserRole', {
      userIds,
      role,
    });
  }

  try {
    if (userIds.length === 0) {
      return success(undefined);
    }

    const pool = await getPool();
    const updatedRows = await pool.query<ProfileRealtimeSnapshot>(
      `
        UPDATE profiles
        SET role = $2::user_role,
            updated_at = NOW()
        WHERE id = ANY($1::uuid[])
        RETURNING
          id::text AS id,
          status::text AS status,
          role::text AS role,
          updated_at::text AS updated_at
      `,
      [userIds, role]
    );

    await publishUpdatedRows(updatedRows.rows);
    return success(undefined);
  } catch (error) {
    console.error('Exception while batch updating user role:', error);
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to batch update user role')
    );
  }
}
