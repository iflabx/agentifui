import {
  type IdentityPersistenceContext,
  getUserIdentityByIssuerSubject,
  upsertUserIdentity,
} from '@lib/db/user-identities';
import { getPgPool } from '@lib/server/pg/pool';
import { Result, failure, success } from '@lib/types/result';
import { randomUUID } from 'node:crypto';

import {
  INTERNAL_AUTH_ISSUER,
  INTERNAL_AUTH_PROVIDER,
  LEGACY_MAPPING_LOCK_PREFIX,
  MISSING_IDENTITY_MAPPING_ERROR_MESSAGE,
  SYSTEM_CONTEXT,
} from '../constants';
import {
  inferProvider,
  isUuid,
  normalizeEmail,
  readFirstString,
  readString,
  splitName,
} from '../helpers';
import type {
  ResolveUserIdReadOnlyResult,
  ResolveUserIdResult,
  SessionUser,
} from '../types';
import { cleanupUnlinkedProfile, ensureProfileStatus } from './profile-status';

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
