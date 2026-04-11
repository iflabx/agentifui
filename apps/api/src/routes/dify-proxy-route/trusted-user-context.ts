import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import { isObjectRecord } from './helpers';
import type { DifyProxyActor } from './types';

const TRUSTED_USER_INPUT_PREFIX = 'agentifui_user_';

const TRUSTED_ROUTE_PATHS = new Set([
  'chat-messages',
  'completion-messages',
  'workflows/run',
]);

interface TrustedUserProfileRow {
  full_name: string | null;
  username: string | null;
  email: string | null;
  employee_number: string | null;
  department: string | null;
  job_title: string | null;
}

export interface TrustedUserProfile {
  fullName: string | null;
  username: string | null;
  email: string | null;
  employeeNumber: string | null;
  department: string | null;
  jobTitle: string | null;
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isPlainObjectRecord(value: unknown): value is Record<string, unknown> {
  if (!isObjectRecord(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function tryParseJsonBody(rawBody: unknown): unknown {
  if (typeof rawBody !== 'string') {
    return rawBody;
  }

  const trimmed = rawBody.trim();
  if (!trimmed) {
    return rawBody;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return rawBody;
  }
}

export function shouldInjectTrustedUserContext(
  method: string,
  slugPath: string
): boolean {
  return method.toUpperCase() === 'POST' && TRUSTED_ROUTE_PATHS.has(slugPath);
}

export async function loadTrustedUserProfile(
  userId: string
): Promise<TrustedUserProfile | null> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return null;
  }

  const rows = await queryRowsWithPgSystemContext<TrustedUserProfileRow>(
    `
      SELECT
        p.full_name,
        p.username,
        p.email,
        p.employee_number,
        pea.department_name AS department,
        pea.job_title
      FROM profiles p
      LEFT JOIN profile_external_attributes pea
        ON pea.user_id = p.id
      WHERE p.id = $1::uuid
      LIMIT 1
    `,
    [normalizedUserId]
  );

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    fullName: normalizeOptionalString(row.full_name),
    username: normalizeOptionalString(row.username),
    email: normalizeOptionalString(row.email),
    employeeNumber: normalizeOptionalString(row.employee_number),
    department: normalizeOptionalString(row.department),
    jobTitle: normalizeOptionalString(row.job_title),
  };
}

export function buildTrustedUserInputs(
  actor: DifyProxyActor,
  profile: TrustedUserProfile | null
): Record<string, string> {
  const inputs: Record<string, string> = {
    agentifui_user_id: actor.userId,
    agentifui_user_role: actor.role,
  };

  const optionalEntries: Array<[string, string | null]> = [
    ['agentifui_user_name', profile?.fullName ?? null],
    ['agentifui_user_username', profile?.username ?? null],
    ['agentifui_user_email', profile?.email ?? null],
    ['agentifui_user_employee_number', profile?.employeeNumber ?? null],
    ['agentifui_user_department', profile?.department ?? null],
    ['agentifui_user_job_title', profile?.jobTitle ?? null],
  ];

  for (const [key, value] of optionalEntries) {
    if (value) {
      inputs[key] = value;
    }
  }

  return inputs;
}

function stripReservedTrustedInputs(
  payload: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(payload).filter(
      ([key]) => !key.startsWith(TRUSTED_USER_INPUT_PREFIX)
    )
  );
}

export function injectTrustedUserContext(
  rawBody: unknown,
  actor: DifyProxyActor,
  profile: TrustedUserProfile | null
): unknown {
  const parsedBody = tryParseJsonBody(rawBody);
  if (!isPlainObjectRecord(parsedBody)) {
    return rawBody;
  }

  const preservedInputs = isPlainObjectRecord(parsedBody.inputs)
    ? stripReservedTrustedInputs(parsedBody.inputs)
    : {};

  return {
    ...parsedBody,
    inputs: {
      ...preservedInputs,
      ...buildTrustedUserInputs(actor, profile),
    },
    user: actor.userId,
  };
}
