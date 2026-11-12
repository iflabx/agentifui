import {
  type IdentityPersistenceContext,
  getUserIdentityByIssuerSubject,
  upsertUserIdentity,
} from '@lib/db/user-identities';
import { Result, failure, success } from '@lib/types/result';

import {
  INTERNAL_AUTH_ISSUER,
  MISSING_AUTH_ACCOUNT_ERROR_MESSAGE,
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
import { ensureProfileStatus } from './profile-status';

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

  return failure(new Error(MISSING_AUTH_ACCOUNT_ERROR_MESSAGE));
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
