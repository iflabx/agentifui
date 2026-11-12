import {
  runWithPgSystemContext,
  runWithPgUserContext,
} from '@lib/server/pg/user-context';
import { Result, failure, success } from '@lib/types/result';

import {
  INTERNAL_AUTH_PROVIDER,
  MISSING_AUTH_ACCOUNT_ERROR_MESSAGE,
} from '../constants';
import {
  inferProvider,
  normalizeEmail,
  readString,
  toProfileRealtimeRow,
} from '../helpers';
import type {
  EnsureProfileResult,
  ProfileStatusRow,
  SessionUser,
} from '../types';
import { publishProfileChangeBestEffort } from './publisher';

export async function ensureProfileStatus(
  userId: string,
  sessionUser: SessionUser
): Promise<Result<EnsureProfileResult>> {
  const profileName = readString(sessionUser.name);
  const profileAvatar = readString(sessionUser.image);
  const profileEmail = normalizeEmail(sessionUser.email);
  const profileAuthSource = inferProvider(sessionUser);

  try {
    const ensured = await runWithPgUserContext(userId, async client => {
      const account = await client.query<{ id: string }>(
        'SELECT id::text FROM auth_users WHERE id::text = $1 FOR KEY SHARE',
        [sessionUser.id]
      );
      if (!account.rows[0]) {
        throw new Error(MISSING_AUTH_ACCOUNT_ERROR_MESSAGE);
      }

      const touchProfile = () =>
        client.query<ProfileStatusRow>(
          `
        UPDATE profiles
        SET
          full_name = CASE
            WHEN $5 = '${INTERNAL_AUTH_PROVIDER}' THEN COALESCE(full_name, $2)
            ELSE COALESCE($2, full_name)
          END,
          avatar_url = COALESCE($3, avatar_url),
          email = COALESCE($4, email),
          auth_source = COALESCE($5, auth_source),
          last_login = NOW(),
          updated_at = NOW()
        WHERE id = $1
        RETURNING
          id::text AS id,
          full_name,
          avatar_url,
          email,
          auth_source,
          last_login::text AS last_login,
          updated_at::text AS updated_at,
          role::text AS role,
          status::text AS status
        `,
          [userId, profileName, profileAvatar, profileEmail, profileAuthSource]
        );

      const touchedExisting = await touchProfile();

      const profile = touchedExisting.rows[0];
      if (profile) {
        return { profile, created: false };
      }

      const inserted = await client.query<ProfileStatusRow>(
        `
        INSERT INTO profiles (
          id,
          full_name,
          avatar_url,
          email,
          auth_source,
          last_login,
          created_at,
          updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), NOW())
        ON CONFLICT (id) DO NOTHING
        RETURNING
          id::text AS id,
          full_name,
          avatar_url,
          email,
          auth_source,
          last_login::text AS last_login,
          updated_at::text AS updated_at,
          role::text AS role,
          status::text AS status
        `,
        [userId, profileName, profileAvatar, profileEmail, profileAuthSource]
      );

      const createdProfile = inserted.rows[0];
      if (createdProfile) {
        return { profile: createdProfile, created: true };
      }

      const touchedAfterConflict = await touchProfile();
      const profileAfterConflict = touchedAfterConflict.rows[0];
      if (profileAfterConflict) {
        return { profile: profileAfterConflict, created: false };
      }

      throw new Error('Failed to resolve profile status for session user');
    });

    await publishProfileChangeBestEffort({
      eventType: ensured.created ? 'INSERT' : 'UPDATE',
      oldRow: null,
      newRow: toProfileRealtimeRow(ensured.profile),
    });
    return success({
      role: ensured.profile.role,
      status: ensured.profile.status,
      created: ensured.created,
    });
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to ensure profile row for session user')
    );
  }
}

export async function cleanupUnlinkedProfile(userId: string): Promise<void> {
  try {
    const deleted = await runWithPgSystemContext(client =>
      client.query<ProfileStatusRow>(
        `
        DELETE FROM profiles
        WHERE id = $1
          AND NOT EXISTS (
            SELECT 1
            FROM user_identities
            WHERE user_id = $1
          )
        RETURNING
          id::text AS id,
          full_name,
          avatar_url,
          email,
          auth_source,
          last_login::text AS last_login,
          updated_at::text AS updated_at,
          role::text AS role,
          status::text AS status
        `,
        [userId]
      )
    );
    const deletedProfile = deleted.rows[0];
    if (deletedProfile) {
      await publishProfileChangeBestEffort({
        eventType: 'DELETE',
        oldRow: toProfileRealtimeRow(deletedProfile),
        newRow: null,
      });
    }
  } catch (error) {
    console.warn(
      `[SessionIdentity] failed to clean transient profile ${userId}:`,
      error
    );
  }
}
