import {
  runWithPgSystemContext,
  runWithPgUserContext,
} from '@lib/server/pg/user-context';
import { Result, failure, success } from '@lib/types/result';

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
    const touchedExisting = await runWithPgUserContext(userId, client =>
      client.query<ProfileStatusRow>(
        `
        UPDATE profiles
        SET
          full_name = COALESCE($2, full_name),
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
      )
    );

    const profile = touchedExisting.rows[0];
    if (profile) {
      await publishProfileChangeBestEffort({
        eventType: 'UPDATE',
        oldRow: null,
        newRow: toProfileRealtimeRow(profile),
      });
      return success({
        role: profile.role,
        status: profile.status,
        created: false,
      });
    }

    const inserted = await runWithPgUserContext(userId, client =>
      client.query<ProfileStatusRow>(
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
      )
    );

    const createdProfile = inserted.rows[0];
    if (createdProfile) {
      await publishProfileChangeBestEffort({
        eventType: 'INSERT',
        oldRow: null,
        newRow: toProfileRealtimeRow(createdProfile),
      });
      return success({
        role: createdProfile.role,
        status: createdProfile.status,
        created: true,
      });
    }

    const touchedAfterConflict = await runWithPgUserContext(userId, client =>
      client.query<ProfileStatusRow>(
        `
        UPDATE profiles
        SET
          full_name = COALESCE($2, full_name),
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
      )
    );
    const profileAfterConflict = touchedAfterConflict.rows[0];
    if (profileAfterConflict) {
      await publishProfileChangeBestEffort({
        eventType: 'UPDATE',
        oldRow: null,
        newRow: toProfileRealtimeRow(profileAfterConflict),
      });
      return success({
        role: profileAfterConflict.role,
        status: profileAfterConflict.status,
        created: false,
      });
    }
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to ensure profile row for session user')
    );
  }

  return failure(
    new Error('Failed to resolve profile status for session user')
  );
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
