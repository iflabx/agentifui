import { getAuthProviderIssuer } from '@lib/auth/better-auth/server';
import type { UpsertProfileExternalAttributesInput } from '@lib/db/user-identities';

import { INTERNAL_AUTH_PROVIDER, PROVIDER_ISSUER_PREFIX } from './constants';
import type {
  AuthSession,
  ProfileStatusRow,
  RealtimeRow,
  SessionUser,
} from './types';

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return value as Record<string, unknown>;
}

export function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

export function readFirstString(
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

export function normalizeEmail(value: unknown): string | null {
  const email = readString(value);
  return email ? email.toLowerCase() : null;
}

export function isActiveStatus(status: string | null | undefined): boolean {
  return (status || '').trim().toLowerCase() === 'active';
}

export function toSessionUser(session: AuthSession): SessionUser | null {
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

export function inferProvider(sessionUser: SessionUser): string {
  const appMetadata =
    asRecord(sessionUser.app_metadata ?? sessionUser.appMetadata) || {};

  return (
    readFirstString(appMetadata, ['provider', 'providerId']) ||
    readFirstString(sessionUser, ['provider', 'providerId', 'auth_source']) ||
    INTERNAL_AUTH_PROVIDER
  );
}

export function splitName(fullName: string | null): {
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

export function buildSourceIssuer(providerId: string): string {
  return (
    getAuthProviderIssuer(providerId) ||
    `${PROVIDER_ISSUER_PREFIX}${providerId}`
  );
}

export function toProfileRealtimeRow(
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

export function buildExternalAttributesPayload(
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
