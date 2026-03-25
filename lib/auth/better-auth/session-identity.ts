import { auth } from '@lib/auth/better-auth/server';
import { Result, failure, success } from '@lib/types/result';

import {
  isRecoverableReadOnlyIdentityError,
  shouldInlineIdentitySync,
  shouldRecoverMissingMappingOnReadOnlyResolve,
} from './session-identity/constants';
import { isActiveStatus, toSessionUser } from './session-identity/helpers';
import {
  ensureProfileStatus,
  loadProfileStatusReadOnly,
  resolveInternalUserId,
  resolveInternalUserIdReadOnly,
  syncExternalAttributes,
} from './session-identity/persistence';
import type { AuthSession, SessionUser } from './session-identity/types';

export { isRecoverableReadOnlyIdentityError };

export interface ResolvedSessionIdentity {
  session: NonNullable<AuthSession>;
  authUserId: string;
  userId: string;
  role: string | null;
  status: string | null;
}

async function resolveSessionWithUser(headers: Headers): Promise<
  Result<{
    session: NonNullable<AuthSession>;
    sessionUser: SessionUser;
  } | null>
> {
  let session: AuthSession = null;

  try {
    session = await auth.api.getSession({ headers });
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to resolve auth session')
    );
  }

  const sessionUser = toSessionUser(session);
  if (!sessionUser) {
    return success(null);
  }

  return success({
    session: session as NonNullable<AuthSession>,
    sessionUser,
  });
}

export async function resolveSessionIdentityReadOnly(
  headers: Headers
): Promise<Result<ResolvedSessionIdentity | null>> {
  const resolvedSession = await resolveSessionWithUser(headers);
  if (!resolvedSession.success) {
    return failure(resolvedSession.error);
  }
  if (!resolvedSession.data) {
    return success(null);
  }

  const { session, sessionUser } = resolvedSession.data;
  const authUserId = sessionUser.id;
  const resolvedUserId = await resolveInternalUserIdReadOnly(authUserId);
  if (!resolvedUserId.success) {
    return failure(resolvedUserId.error);
  }

  const profileStatus = await loadProfileStatusReadOnly(
    resolvedUserId.data.userId
  );
  if (!profileStatus.success) {
    return failure(profileStatus.error);
  }
  if (!isActiveStatus(profileStatus.data.status)) {
    return success(null);
  }

  return success({
    session,
    authUserId,
    userId: resolvedUserId.data.userId,
    role: profileStatus.data.role,
    status: profileStatus.data.status,
  });
}

export async function syncSessionIdentitySideEffects(
  headers: Headers
): Promise<Result<ResolvedSessionIdentity | null>> {
  const resolvedSession = await resolveSessionWithUser(headers);
  if (!resolvedSession.success) {
    return failure(resolvedSession.error);
  }
  if (!resolvedSession.data) {
    return success(null);
  }

  const { session, sessionUser } = resolvedSession.data;
  const authUserId = sessionUser.id;
  const resolvedUserId = await resolveInternalUserId(authUserId, sessionUser);
  if (!resolvedUserId.success) {
    return failure(resolvedUserId.error);
  }

  let ensuredProfileData = resolvedUserId.data.ensuredProfile;
  if (!ensuredProfileData) {
    const ensuredProfile = await ensureProfileStatus(
      resolvedUserId.data.userId,
      sessionUser
    );
    if (!ensuredProfile.success) {
      return failure(ensuredProfile.error);
    }
    ensuredProfileData = ensuredProfile.data;
  }

  if (!isActiveStatus(ensuredProfileData.status)) {
    return success(null);
  }

  await syncExternalAttributes(resolvedUserId.data.userId, sessionUser);

  return success({
    session,
    authUserId,
    userId: resolvedUserId.data.userId,
    role: ensuredProfileData.role,
    status: ensuredProfileData.status,
  });
}

export async function resolveSessionIdentity(
  headers: Headers
): Promise<Result<ResolvedSessionIdentity | null>> {
  if (shouldInlineIdentitySync()) {
    return syncSessionIdentitySideEffects(headers);
  }

  const readOnlyResolved = await resolveSessionIdentityReadOnly(headers);
  if (readOnlyResolved.success || !readOnlyResolved.error) {
    return readOnlyResolved;
  }

  if (
    !shouldRecoverMissingMappingOnReadOnlyResolve() ||
    !isRecoverableReadOnlyIdentityError(readOnlyResolved.error)
  ) {
    return readOnlyResolved;
  }

  return syncSessionIdentitySideEffects(headers);
}
