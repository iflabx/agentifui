import {
  type IdentityPersistenceContext,
  getProfileExternalAttributes,
  getUserIdentityByIssuerSubject,
  upsertProfileExternalAttributes,
  upsertUserIdentity,
} from '@lib/db/user-identities';
import { getPgPool } from '@lib/server/pg/pool';
import {
  runWithPgSystemContext,
  runWithPgUserContext,
} from '@lib/server/pg/user-context';
import { Result, failure, success } from '@lib/types/result';
import { randomUUID } from 'node:crypto';

import {
  INTERNAL_AUTH_ISSUER,
  INTERNAL_AUTH_PROVIDER,
  LEGACY_MAPPING_LOCK_PREFIX,
  MISSING_IDENTITY_MAPPING_ERROR_MESSAGE,
  MISSING_PROFILE_ROW_ERROR_MESSAGE,
  SYSTEM_CONTEXT,
  getExternalAttributesSyncIntervalMs,
  shouldUseIntervalExternalAttributesSync,
} from './constants';
import {
  buildExternalAttributesPayload,
  inferProvider,
  isUuid,
  normalizeEmail,
  readFirstString,
  readString,
  splitName,
  toProfileRealtimeRow,
} from './helpers';
import type {
  EnsureProfileResult,
  ProfileStatusRow,
  RealtimePublisher,
  ResolveUserIdReadOnlyResult,
  ResolveUserIdResult,
  SessionUser,
} from './types';

async function publishProfileChangeBestEffort(input: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: Record<string, unknown> | null;
  oldRow: Record<string, unknown> | null;
}): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    return;
  }

  try {
    const publisherModule = (await import(
      '@lib/server/realtime/publisher'
    )) as {
      publishTableChangeEvent?: RealtimePublisher;
    };
    const publisher = publisherModule.publishTableChangeEvent;
    if (typeof publisher !== 'function') {
      return;
    }

    await publisher({
      table: 'profiles',
      eventType: input.eventType,
      oldRow: input.oldRow,
      newRow: input.newRow,
    });
  } catch (error) {
    console.warn(
      '[SessionIdentity] failed to publish profile realtime event:',
      {
        error,
        eventType: input.eventType,
      }
    );
  }
}

async function upsertPrimarySessionIdentity(
  userId: string,
  sessionUser: SessionUser
): Promise<Result<void>> {
  const fullName = readString(sessionUser.name);
  const split = splitName(fullName);
  const provider = inferProvider(sessionUser);
  const context: IdentityPersistenceContext = {
    actorUserId: userId,
  };
  const upsertIdentity = await upsertUserIdentity(
    {
      user_id: userId,
      issuer: INTERNAL_AUTH_ISSUER,
      provider,
      subject: userId,
      email: normalizeEmail(sessionUser.email),
      email_verified: Boolean(sessionUser.emailVerified),
      given_name: split.givenName,
      family_name: split.familyName,
      preferred_username: readFirstString(sessionUser, [
        'preferred_username',
        'preferredUsername',
        'username',
        'login',
      ]),
      raw_claims: {
        ...sessionUser,
        _identity_source: 'better-auth/session',
        _provider_hint: provider,
      },
    },
    context
  );

  if (!upsertIdentity.success) {
    return failure(upsertIdentity.error);
  }

  return success(undefined);
}

async function withLegacyMappingLock<T>(
  authUserId: string,
  callback: () => Promise<Result<T>>
): Promise<Result<T>> {
  const pool = getPgPool();
  const client = await pool.connect();
  const lockKey = `${LEGACY_MAPPING_LOCK_PREFIX}:${authUserId}`;

  try {
    await client.query(
      'SELECT pg_advisory_lock(hashtextextended($1::text, 0))',
      [lockKey]
    );
    return await callback();
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to acquire legacy identity mapping lock')
    );
  } finally {
    try {
      await client.query(
        'SELECT pg_advisory_unlock(hashtextextended($1::text, 0))',
        [lockKey]
      );
    } catch (unlockError) {
      console.warn(
        '[SessionIdentity] failed to release legacy identity mapping lock:',
        unlockError
      );
    }
    client.release();
  }
}

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

async function cleanupUnlinkedProfile(userId: string): Promise<void> {
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

export async function resolveInternalUserId(
  authUserId: string,
  sessionUser: SessionUser
): Promise<Result<ResolveUserIdResult>> {
  if (isUuid(authUserId)) {
    const ensuredProfile = await ensureProfileStatus(authUserId, sessionUser);
    if (!ensuredProfile.success) {
      return failure(ensuredProfile.error);
    }

    const upsertIdentity = await upsertPrimarySessionIdentity(
      authUserId,
      sessionUser
    );
    if (!upsertIdentity.success) {
      return failure(upsertIdentity.error);
    }

    return success({
      userId: authUserId,
      createdLegacyMapping: false,
      ensuredProfile: ensuredProfile.data,
    });
  }

  const existingIdentity = await getUserIdentityByIssuerSubject(
    INTERNAL_AUTH_ISSUER,
    authUserId,
    SYSTEM_CONTEXT
  );
  if (!existingIdentity.success) {
    return failure(existingIdentity.error);
  }

  if (existingIdentity.data?.user_id) {
    return success({
      userId: existingIdentity.data.user_id,
      createdLegacyMapping: false,
    });
  }

  return withLegacyMappingLock(authUserId, async () => {
    const recheckedIdentity = await getUserIdentityByIssuerSubject(
      INTERNAL_AUTH_ISSUER,
      authUserId,
      SYSTEM_CONTEXT
    );
    if (!recheckedIdentity.success) {
      return failure(recheckedIdentity.error);
    }

    if (recheckedIdentity.data?.user_id) {
      return success({
        userId: recheckedIdentity.data.user_id,
        createdLegacyMapping: false,
      });
    }

    const fallbackUserId = randomUUID();
    const fullName = readString(sessionUser.name);
    const split = splitName(fullName);
    const provider = inferProvider(sessionUser);
    const ensuredProfile = await ensureProfileStatus(
      fallbackUserId,
      sessionUser
    );
    if (!ensuredProfile.success) {
      return failure(ensuredProfile.error);
    }

    const upsertIdentity = await upsertUserIdentity(
      {
        user_id: fallbackUserId,
        issuer: INTERNAL_AUTH_ISSUER,
        provider: INTERNAL_AUTH_PROVIDER,
        subject: authUserId,
        email: normalizeEmail(sessionUser.email),
        email_verified: Boolean(sessionUser.emailVerified),
        given_name: split.givenName,
        family_name: split.familyName,
        preferred_username: readFirstString(sessionUser, [
          'preferred_username',
          'preferredUsername',
          'username',
          'login',
        ]),
        raw_claims: {
          ...sessionUser,
          _identity_source: 'better-auth/session',
          _provider_hint: provider,
        },
      },
      { actorUserId: fallbackUserId }
    );

    if (!upsertIdentity.success) {
      return failure(upsertIdentity.error);
    }

    const resolvedUserId = upsertIdentity.data.user_id;
    if (!resolvedUserId) {
      return failure(
        new Error('Failed to resolve user_id from identity mapping')
      );
    }

    const createdLegacyMapping = resolvedUserId === fallbackUserId;
    if (!createdLegacyMapping && ensuredProfile.data.created) {
      await cleanupUnlinkedProfile(fallbackUserId);
    }

    return success({
      userId: resolvedUserId,
      createdLegacyMapping,
      ensuredProfile: createdLegacyMapping ? ensuredProfile.data : undefined,
    });
  });
}

export async function resolveInternalUserIdReadOnly(
  authUserId: string
): Promise<Result<ResolveUserIdReadOnlyResult>> {
  if (isUuid(authUserId)) {
    return success({ userId: authUserId });
  }

  const existingIdentity = await getUserIdentityByIssuerSubject(
    INTERNAL_AUTH_ISSUER,
    authUserId,
    SYSTEM_CONTEXT
  );
  if (!existingIdentity.success) {
    return failure(existingIdentity.error);
  }

  if (!existingIdentity.data?.user_id) {
    return failure(new Error(MISSING_IDENTITY_MAPPING_ERROR_MESSAGE));
  }

  return success({
    userId: existingIdentity.data.user_id,
  });
}

export async function syncExternalAttributes(
  userId: string,
  sessionUser: SessionUser
): Promise<void> {
  const payload = buildExternalAttributesPayload(userId, sessionUser);
  if (!payload) {
    return;
  }

  const existingAttributes = await getProfileExternalAttributes(userId, {
    actorUserId: userId,
  });
  if (!existingAttributes.success) {
    console.warn(
      '[SessionIdentity] failed to load existing external attributes:',
      existingAttributes.error
    );
  } else if (existingAttributes.data) {
    const normalizedIssuer = payload.source_issuer.trim().toLowerCase();
    const sameSource =
      existingAttributes.data.source_issuer.trim().toLowerCase() ===
        normalizedIssuer &&
      existingAttributes.data.source_provider.trim() ===
        payload.source_provider.trim();

    if (sameSource) {
      const syncedAtMs = Date.parse(existingAttributes.data.synced_at);
      const syncIntervalMs = getExternalAttributesSyncIntervalMs();
      const isFresh =
        Number.isFinite(syncedAtMs) && Date.now() - syncedAtMs < syncIntervalMs;
      if (shouldUseIntervalExternalAttributesSync() && isFresh) {
        return;
      }
    }
  }

  const upsert = await upsertProfileExternalAttributes(payload, {
    actorUserId: userId,
  });
  if (!upsert.success) {
    console.warn(
      '[SessionIdentity] failed to sync external profile attributes:',
      upsert.error
    );
  }
}

export async function loadProfileStatusReadOnly(userId: string): Promise<
  Result<{
    role: string | null;
    status: string | null;
  }>
> {
  try {
    const queryResult = await runWithPgUserContext(userId, client =>
      client.query<ProfileStatusRow>(
        `
          SELECT
            role::text AS role,
            status::text AS status
          FROM profiles
          WHERE id = $1::uuid
          LIMIT 1
        `,
        [userId]
      )
    );
    const row = queryResult.rows[0];
    if (!row) {
      return failure(new Error(MISSING_PROFILE_ROW_ERROR_MESSAGE));
    }

    return success({
      role: row.role ?? null,
      status: row.status ?? null,
    });
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to load profile status for session user')
    );
  }
}
