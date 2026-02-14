import { auth, getAuthProviderIssuer } from '@lib/auth/better-auth/server';
import {
  type UpsertProfileExternalAttributesInput,
  getUserIdentityByIssuerSubject,
  upsertProfileExternalAttributes,
  upsertUserIdentity,
} from '@lib/db/user-identities';
import { getPgPool } from '@lib/server/pg/pool';
import { Result, failure, success } from '@lib/types/result';
import { randomUUID } from 'node:crypto';

const INTERNAL_AUTH_ISSUER = 'urn:agentifui:better-auth';
const INTERNAL_AUTH_PROVIDER = 'better-auth';
const PROVIDER_ISSUER_PREFIX = 'urn:better-auth:provider:';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
type SessionUser = Record<string, unknown> & {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  emailVerified?: boolean;
};

type ProfileStatusRow = {
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
};

type BetterAuthLinkedAccount = {
  id?: string;
  providerId?: string;
  provider_id?: string;
  accountId?: string;
  account_id?: string;
  [key: string]: unknown;
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

async function resolveInternalUserId(
  authUserId: string,
  sessionUser: SessionUser
): Promise<Result<ResolveUserIdResult>> {
  if (isUuid(authUserId)) {
    return success({
      userId: authUserId,
      createdLegacyMapping: false,
    });
  }

  const existingIdentity = await getUserIdentityByIssuerSubject(
    INTERNAL_AUTH_ISSUER,
    authUserId
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

  const fallbackUserId = randomUUID();
  const fullName = readString(sessionUser.name);
  const split = splitName(fullName);
  const provider = inferProvider(sessionUser);
  const upsertIdentity = await upsertUserIdentity({
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
  });

  if (!upsertIdentity.success) {
    return failure(upsertIdentity.error);
  }

  return success({
    userId: fallbackUserId,
    createdLegacyMapping: true,
  });
}

async function ensureProfileStatus(
  userId: string,
  sessionUser: SessionUser
): Promise<Result<EnsureProfileResult>> {
  const pool = getPgPool();

  try {
    const existing = await pool.query<ProfileStatusRow>(
      `
      SELECT
        role::text AS role,
        status::text AS status
      FROM profiles
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );

    const profile = existing.rows[0];
    if (profile) {
      return success({
        role: profile.role,
        status: profile.status,
        created: false,
      });
    }

    const inserted = await pool.query<ProfileStatusRow>(
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
        role::text AS role,
        status::text AS status
      `,
      [
        userId,
        readString(sessionUser.name),
        readString(sessionUser.image),
        normalizeEmail(sessionUser.email),
        inferProvider(sessionUser),
      ]
    );

    const createdProfile = inserted.rows[0];
    if (createdProfile) {
      return success({
        role: createdProfile.role,
        status: createdProfile.status,
        created: true,
      });
    }

    const afterConflict = await pool.query<ProfileStatusRow>(
      `
      SELECT
        role::text AS role,
        status::text AS status
      FROM profiles
      WHERE id = $1
      LIMIT 1
      `,
      [userId]
    );
    const profileAfterConflict = afterConflict.rows[0];
    if (profileAfterConflict) {
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

async function syncLinkedAccountIdentities(
  headers: Headers,
  userId: string,
  sessionUser: SessionUser
): Promise<void> {
  type ListUserAccountsFn = (input: { headers: Headers }) => Promise<unknown>;

  const listUserAccounts = (
    auth.api as { listUserAccounts?: ListUserAccountsFn }
  ).listUserAccounts;

  if (typeof listUserAccounts !== 'function') {
    return;
  }

  let rawAccounts: unknown;
  try {
    rawAccounts = await listUserAccounts({ headers });
  } catch (error) {
    console.warn('[SessionIdentity] listUserAccounts failed:', error);
    return;
  }

  if (!Array.isArray(rawAccounts)) {
    return;
  }

  const fullName = readString(sessionUser.name);
  const split = splitName(fullName);

  for (const rawAccount of rawAccounts) {
    const account = asRecord(rawAccount) as BetterAuthLinkedAccount;
    const providerId = readFirstString(account, ['providerId', 'provider_id']);
    const accountId = readFirstString(account, ['accountId', 'account_id']);

    if (!providerId || !accountId) {
      continue;
    }

    const issuer = buildSourceIssuer(providerId);
    const existing = await getUserIdentityByIssuerSubject(issuer, accountId);

    if (!existing.success) {
      console.warn(
        `[SessionIdentity] failed to check existing identity for ${providerId}:`,
        existing.error
      );
      continue;
    }

    if (existing.data?.user_id && existing.data.user_id !== userId) {
      console.warn(
        `[SessionIdentity] identity conflict for ${providerId}:${accountId}; keeping existing owner ${existing.data.user_id}`
      );
      continue;
    }

    if (existing.data?.user_id === userId) {
      continue;
    }

    const upsert = await upsertUserIdentity({
      user_id: userId,
      issuer,
      provider: providerId,
      subject: accountId,
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
        ...account,
        _identity_source: 'better-auth/list-accounts',
      },
    });

    if (!upsert.success) {
      console.warn(
        `[SessionIdentity] failed to upsert provider identity for ${providerId}:`,
        upsert.error
      );
    }
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

  const upsert = await upsertProfileExternalAttributes(payload);
  if (!upsert.success) {
    console.warn(
      '[SessionIdentity] failed to sync external profile attributes:',
      upsert.error
    );
  }
}

export async function resolveSessionIdentity(
  headers: Headers
): Promise<Result<ResolvedSessionIdentity | null>> {
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

  const authUserId = sessionUser.id;
  const resolvedUserId = await resolveInternalUserId(authUserId, sessionUser);
  if (!resolvedUserId.success) {
    return failure(resolvedUserId.error);
  }

  const ensuredProfile = await ensureProfileStatus(
    resolvedUserId.data.userId,
    sessionUser
  );
  if (!ensuredProfile.success) {
    return failure(ensuredProfile.error);
  }

  const shouldSyncIdentityData =
    resolvedUserId.data.createdLegacyMapping || ensuredProfile.data.created;
  if (shouldSyncIdentityData) {
    await syncLinkedAccountIdentities(
      headers,
      resolvedUserId.data.userId,
      sessionUser
    );
    await syncExternalAttributes(resolvedUserId.data.userId, sessionUser);
  }

  return success({
    session: session as NonNullable<AuthSession>,
    authUserId,
    userId: resolvedUserId.data.userId,
    role: ensuredProfile.data.role,
    status: ensuredProfile.data.status,
  });
}
