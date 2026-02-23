import { auth, getAuthProviderIssuer } from '@lib/auth/better-auth/server';
import {
  type IdentityPersistenceContext,
  type UpsertProfileExternalAttributesInput,
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

const INTERNAL_AUTH_ISSUER = 'urn:agentifui:better-auth';
const INTERNAL_AUTH_PROVIDER = 'better-auth';
const PROVIDER_ISSUER_PREFIX = 'urn:better-auth:provider:';
const LEGACY_MAPPING_LOCK_PREFIX = 'legacy-auth-user';
const DEFAULT_EXTERNAL_ATTRIBUTES_SYNC_INTERVAL_MS = 15 * 60 * 1000;
const MISSING_IDENTITY_MAPPING_ERROR_MESSAGE =
  'Missing identity mapping for non-UUID auth session user';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isTruthyEnv(value: string | undefined): boolean {
  const normalized = (value || '').trim().toLowerCase();
  return (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  );
}

function parseBooleanEnv(
  value: string | undefined,
  fallbackValue: boolean
): boolean {
  if (!value) {
    return fallbackValue;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === '1' ||
    normalized === 'true' ||
    normalized === 'yes' ||
    normalized === 'on'
  ) {
    return true;
  }
  if (
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'no' ||
    normalized === 'off'
  ) {
    return false;
  }
  return fallbackValue;
}

function shouldInlineIdentitySync(): boolean {
  return isTruthyEnv(process.env.AUTH_IDENTITY_SYNC_INLINE);
}

function shouldRecoverMissingMappingOnReadOnlyResolve(): boolean {
  return parseBooleanEnv(
    process.env.AUTH_IDENTITY_RECOVER_MISSING_MAPPING,
    true
  );
}

function getExternalAttributesSyncIntervalMs(): number {
  const parsed = Number(process.env.EXTERNAL_ATTRIBUTES_SYNC_INTERVAL_MS);
  if (Number.isFinite(parsed) && parsed >= 0) {
    return parsed;
  }
  return DEFAULT_EXTERNAL_ATTRIBUTES_SYNC_INTERVAL_MS;
}

function shouldUseIntervalExternalAttributesSync(): boolean {
  return (
    (process.env.EXTERNAL_ATTRIBUTES_SYNC_MODE || '').trim().toLowerCase() ===
    'interval'
  );
}

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
type SessionUser = Record<string, unknown> & {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  emailVerified?: boolean;
};

type ProfileStatusRow = {
  id?: string;
  full_name?: string | null;
  avatar_url?: string | null;
  email?: string | null;
  auth_source?: string | null;
  last_login?: string | null;
  updated_at?: string | null;
  role: string | null;
  status: string | null;
};

type EnsureProfileResult = {
  role: string | null;
  status: string | null;
  created: boolean;
};

type ResolveUserIdResult = {
  userId: string;
  createdLegacyMapping: boolean;
  ensuredProfile?: EnsureProfileResult;
};

type ResolveUserIdReadOnlyResult = {
  userId: string;
};

type RealtimeRow = Record<string, unknown>;

type RealtimePublisher = (input: {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: RealtimeRow | null;
  oldRow: RealtimeRow | null;
  schema?: string;
  commitTimestamp?: string;
}) => Promise<void>;

const SYSTEM_CONTEXT: IdentityPersistenceContext = {
  useSystemActor: true,
};

export interface ResolvedSessionIdentity {
  session: NonNullable<AuthSession>;
  authUserId: string;
  userId: string;
  role: string | null;
  status: string | null;
}

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function readFirstString(
  source: Record<string, unknown>,
  keys: string[]
): string | null {
  for (const key of keys) {
    const value = readString(source[key]);
    if (value) {
      return value;
    }
  }

  return null;
}

function readProfileDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

function normalizeEmail(value: unknown): string | null {
  const email = readString(value);
  return email ? email.toLowerCase() : null;
}

function isActiveStatus(status: string | null | undefined): boolean {
  return (status || '').trim().toLowerCase() === 'active';
}

function toSessionUser(session: AuthSession): SessionUser | null {
  if (!session?.user || typeof session.user !== 'object') {
    return null;
  }

  const user = asRecord(session.user);
  const id = readString(user.id);
  if (!id) {
    return null;
  }

  return {
    ...user,
    id,
    email: normalizeEmail(user.email),
    name: readString(user.name),
    image: readString(user.image),
    emailVerified: Boolean(user.emailVerified),
  };
}

function inferProvider(sessionUser: SessionUser): string {
  const appMetadata =
    asRecord(sessionUser.app_metadata ?? sessionUser.appMetadata) || {};

  return (
    readFirstString(appMetadata, ['provider', 'providerId']) ||
    readFirstString(sessionUser, ['provider', 'providerId', 'auth_source']) ||
    INTERNAL_AUTH_PROVIDER
  );
}

function splitName(fullName: string | null): {
  givenName: string | null;
  familyName: string | null;
} {
  if (!fullName) {
    return { givenName: null, familyName: null };
  }

  const normalized = fullName.trim();
  if (!normalized) {
    return { givenName: null, familyName: null };
  }

  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length <= 1) {
    return { givenName: parts[0] ?? null, familyName: null };
  }

  return {
    givenName: parts[0] ?? null,
    familyName: parts.slice(1).join(' '),
  };
}

function buildSourceIssuer(providerId: string): string {
  return (
    getAuthProviderIssuer(providerId) ||
    `${PROVIDER_ISSUER_PREFIX}${providerId}`
  );
}

function toProfileRealtimeRow(
  row: ProfileStatusRow | null
): RealtimeRow | null {
  if (!row || !row.id) {
    return null;
  }

  return {
    id: row.id,
    full_name: row.full_name ?? null,
    avatar_url: row.avatar_url ?? null,
    email: row.email ?? null,
    auth_source: row.auth_source ?? null,
    role: row.role ?? null,
    status: row.status ?? null,
    last_login: row.last_login ?? null,
    updated_at: row.updated_at ?? null,
  };
}

async function publishProfileChangeBestEffort(input: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: RealtimeRow | null;
  oldRow: RealtimeRow | null;
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

async function resolveInternalUserId(
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

async function resolveInternalUserIdReadOnly(
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

async function ensureProfileStatus(
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

function buildExternalAttributesPayload(
  userId: string,
  sessionUser: SessionUser
): UpsertProfileExternalAttributesInput | null {
  const provider = inferProvider(sessionUser);
  const sourceIssuer = buildSourceIssuer(provider);
  const claims = asRecord(sessionUser);
  const rawAttributes =
    asRecord(claims.attributes ?? claims.profile_attributes) || {};

  const payload: UpsertProfileExternalAttributesInput = {
    user_id: userId,
    source_issuer: sourceIssuer,
    source_provider: provider,
    employee_number: readFirstString(claims, [
      'employee_number',
      'employeeNumber',
      'employee_id',
      'employeeId',
    ]),
    department_code: readFirstString(claims, [
      'department_code',
      'departmentCode',
      'dept_code',
      'deptCode',
    ]),
    department_name: readFirstString(claims, [
      'department_name',
      'departmentName',
      'department',
    ]),
    department_path: readFirstString(claims, [
      'department_path',
      'departmentPath',
    ]),
    cost_center: readFirstString(claims, ['cost_center', 'costCenter']),
    job_title: readFirstString(claims, ['job_title', 'jobTitle', 'title']),
    employment_type: readFirstString(claims, [
      'employment_type',
      'employmentType',
    ]),
    manager_employee_number: readFirstString(claims, [
      'manager_employee_number',
      'managerEmployeeNumber',
      'manager_id',
      'managerId',
    ]),
    manager_name: readFirstString(claims, ['manager_name', 'managerName']),
    phone_e164: readFirstString(claims, [
      'phone_e164',
      'phoneE164',
      'phone',
      'phoneNumber',
    ]),
    office_location: readFirstString(claims, [
      'office_location',
      'officeLocation',
      'office',
    ]),
    hire_date: readProfileDate(
      readFirstString(claims, ['hire_date', 'hireDate', 'employmentDate'])
    ),
    attributes: rawAttributes,
    raw_profile: claims,
  };

  const hasKnownFields = Boolean(
    payload.employee_number ||
      payload.department_code ||
      payload.department_name ||
      payload.department_path ||
      payload.cost_center ||
      payload.job_title ||
      payload.employment_type ||
      payload.manager_employee_number ||
      payload.manager_name ||
      payload.phone_e164 ||
      payload.office_location ||
      payload.hire_date
  );

  const hasCustomAttributes = Object.keys(payload.attributes || {}).length > 0;
  if (!hasKnownFields && !hasCustomAttributes) {
    return null;
  }

  return payload;
}

async function syncExternalAttributes(
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

async function loadProfileStatusReadOnly(userId: string): Promise<
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
      return failure(new Error('Missing profile row for session user'));
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
    !readOnlyResolved.error.message.includes(
      MISSING_IDENTITY_MAPPING_ERROR_MESSAGE
    )
  ) {
    return readOnlyResolved;
  }

  return syncSessionIdentitySideEffects(headers);
}
