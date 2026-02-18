import { getPgPool } from '@lib/server/pg/pool';
import {
  queryRowsWithPgSystemContext,
  queryRowsWithPgUserContext,
} from '@lib/server/pg/user-context';
import { Result, failure, success } from '@lib/types/result';

export type AuthMode = 'normal' | 'degraded';

export interface LocalLoginPolicyContext {
  actorUserId?: string | null;
  useSystemActor?: boolean;
}

const SYSTEM_POLICY_CONTEXT: LocalLoginPolicyContext = {
  useSystemActor: true,
};
const LOCAL_PASSWORD_AUTH_SOURCES = new Set([
  '',
  'password',
  'better-auth',
  'credentials',
]);

type ProfileLocalLoginRow = {
  id: string;
  auth_source: string | null;
  local_login_enabled: boolean | null;
};

type AuthModeRow = {
  auth_mode: string | null;
};

type ProfileLocalLoginStateRow = {
  id: string;
  email: string | null;
  auth_source: string | null;
  local_login_enabled: boolean | null;
  local_login_updated_at: string | Date | null;
  fallback_password_set_at: string | Date | null;
  fallback_password_updated_by: string | null;
  updated_at?: string | Date | null;
};

type CredentialPasswordExistsRow = {
  has_credential_password: boolean | null;
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

export type LocalLoginDecisionReason =
  | 'email_missing'
  | 'profile_not_found'
  | 'password_account'
  | 'blocked_auth_mode'
  | 'blocked_user_toggle'
  | 'missing_fallback_password'
  | 'allowed_degraded';

export interface LocalLoginDecision {
  allowed: boolean;
  authMode: AuthMode;
  email: string | null;
  userId: string | null;
  reason: LocalLoginDecisionReason;
}

export interface UserLocalLoginState {
  userId: string;
  email: string | null;
  authSource: string | null;
  localLoginEnabled: boolean;
  localLoginUpdatedAt: string | null;
  fallbackPasswordSetAt: string | null;
  fallbackPasswordUpdatedBy: string | null;
}

export interface LocalLoginAuditInput {
  email: string | null;
  userId: string | null;
  authMode: AuthMode;
  outcome: 'blocked' | 'success' | 'failed';
  reason: string | null;
  statusCode?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') {
    return null;
  }

  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function normalizeActorUserId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function queryRowsWithPolicyContext<T extends object>(
  sql: string,
  params: unknown[] = [],
  context: LocalLoginPolicyContext = SYSTEM_POLICY_CONTEXT
): Promise<T[]> {
  const actorUserId = normalizeActorUserId(context.actorUserId);
  if (actorUserId) {
    return queryRowsWithPgUserContext<T>(actorUserId, sql, params);
  }

  if (context.useSystemActor !== false) {
    return queryRowsWithPgSystemContext<T>(sql, params);
  }

  const pool = getPgPool();
  const { rows } = await pool.query<T>(sql, params);
  return rows;
}

function normalizeAuthMode(input: string | null | undefined): AuthMode {
  if (input === 'degraded') {
    return 'degraded';
  }

  return 'normal';
}

function isLocalPasswordAuthSource(authSource: string): boolean {
  return LOCAL_PASSWORD_AUTH_SOURCES.has(authSource);
}

function isAuthMode(input: string): input is AuthMode {
  return input === 'normal' || input === 'degraded';
}

function toIsoString(value: string | Date | null | undefined): string | null {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

function toProfileRealtimeRow(
  row: ProfileLocalLoginStateRow | null
): RealtimeRow | null {
  if (!row?.id) {
    return null;
  }

  return {
    id: row.id,
    email: row.email ?? null,
    auth_source: row.auth_source ?? null,
    local_login_enabled: Boolean(row.local_login_enabled),
    local_login_updated_at: toIsoString(row.local_login_updated_at),
    fallback_password_set_at: toIsoString(row.fallback_password_set_at),
    fallback_password_updated_by: row.fallback_password_updated_by ?? null,
    updated_at: toIsoString(row.updated_at),
  };
}

async function publishProfileChangeBestEffort(input: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  oldRow: RealtimeRow | null;
  newRow: RealtimeRow | null;
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
    console.warn('[AuthLocalLoginPolicy] failed to publish profile realtime:', {
      error,
      eventType: input.eventType,
    });
  }
}

async function loadProfileRealtimeRowByUserId(
  userId: string,
  context: LocalLoginPolicyContext = SYSTEM_POLICY_CONTEXT
): Promise<ProfileLocalLoginStateRow | null> {
  const rows = await queryRowsWithPolicyContext<ProfileLocalLoginStateRow>(
    `
      SELECT
        id::text AS id,
        email,
        auth_source,
        local_login_enabled,
        local_login_updated_at,
        fallback_password_set_at,
        fallback_password_updated_by::text AS fallback_password_updated_by,
        updated_at
      FROM profiles
      WHERE id = $1::uuid
      LIMIT 1
    `,
    [userId],
    context
  );
  return rows[0] || null;
}

async function getCurrentAuthMode(
  context: LocalLoginPolicyContext = SYSTEM_POLICY_CONTEXT
): Promise<Result<AuthMode>> {
  try {
    const rows = await queryRowsWithPolicyContext<AuthModeRow>(
      `
      SELECT auth_mode
      FROM auth_settings
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 1
      `,
      [],
      context
    );

    return success(normalizeAuthMode(rows[0]?.auth_mode));
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to load current auth mode')
    );
  }
}

export async function getAuthModeSetting(
  context: LocalLoginPolicyContext = SYSTEM_POLICY_CONTEXT
): Promise<Result<AuthMode>> {
  return getCurrentAuthMode(context);
}

export async function setAuthModeSetting(
  authMode: AuthMode,
  context: LocalLoginPolicyContext = SYSTEM_POLICY_CONTEXT
): Promise<Result<AuthMode>> {
  if (!isAuthMode(authMode)) {
    return failure(new Error('Invalid auth mode'));
  }

  try {
    const updatedRows = await queryRowsWithPolicyContext<AuthModeRow>(
      `
      WITH target AS (
        SELECT id
        FROM auth_settings
        ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
        LIMIT 1
      )
      UPDATE auth_settings
      SET auth_mode = $1, updated_at = NOW()
      WHERE id = (SELECT id FROM target)
      RETURNING auth_mode
      `,
      [authMode],
      context
    );

    if (updatedRows[0]) {
      return success(normalizeAuthMode(updatedRows[0].auth_mode));
    }

    const insertedRows = await queryRowsWithPolicyContext<AuthModeRow>(
      `
      INSERT INTO auth_settings (auth_mode, created_at, updated_at)
      VALUES ($1, NOW(), NOW())
      RETURNING auth_mode
      `,
      [authMode],
      context
    );

    return success(normalizeAuthMode(insertedRows[0]?.auth_mode));
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to update auth mode setting')
    );
  }
}

async function getProfileByEmail(
  email: string,
  context: LocalLoginPolicyContext = SYSTEM_POLICY_CONTEXT
): Promise<Result<ProfileLocalLoginRow | null>> {
  try {
    const rows = await queryRowsWithPolicyContext<ProfileLocalLoginRow>(
      `
      SELECT
        p.id::text AS id,
        p.auth_source,
        p.local_login_enabled
      FROM auth_users u
      LEFT JOIN profiles p
        ON p.id = u.id
      WHERE lower(u.email) = $1
      LIMIT 1
      `,
      [email],
      context
    );

    const row = rows[0];
    return success(row?.id ? row : null);
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to load profile by email')
    );
  }
}

async function hasCredentialPasswordByEmail(
  email: string,
  context: LocalLoginPolicyContext = SYSTEM_POLICY_CONTEXT
): Promise<Result<boolean>> {
  try {
    const rows = await queryRowsWithPolicyContext<CredentialPasswordExistsRow>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM auth_users u
        JOIN auth_accounts a
          ON a.user_id = u.id
        WHERE lower(u.email) = $1
          AND a.provider_id = 'credential'
          AND a.password IS NOT NULL
      ) AS has_credential_password
      `,
      [email],
      context
    );

    return success(Boolean(rows[0]?.has_credential_password));
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to check credential password by email')
    );
  }
}

export async function hasCredentialPasswordByAuthUserId(
  authUserId: string,
  context: LocalLoginPolicyContext = SYSTEM_POLICY_CONTEXT
): Promise<Result<boolean>> {
  const normalizedAuthUserId = authUserId.trim();
  if (!normalizedAuthUserId) {
    return failure(new Error('authUserId is required'));
  }

  try {
    const rows = await queryRowsWithPolicyContext<CredentialPasswordExistsRow>(
      `
      SELECT EXISTS (
        SELECT 1
        FROM auth_accounts
        WHERE user_id = $1::uuid
          AND provider_id = 'credential'
          AND password IS NOT NULL
      ) AS has_credential_password
      `,
      [normalizedAuthUserId],
      context
    );

    return success(Boolean(rows[0]?.has_credential_password));
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to check credential password by auth user id')
    );
  }
}

export async function markFallbackPasswordUpdated(
  userId: string,
  updatedByUserId?: string | null,
  context: LocalLoginPolicyContext = SYSTEM_POLICY_CONTEXT
): Promise<Result<void>> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return failure(new Error('userId is required'));
  }

  const normalizedUpdatedBy = updatedByUserId?.trim() || normalizedUserId;

  try {
    const oldRow = await loadProfileRealtimeRowByUserId(
      normalizedUserId,
      context
    );
    const updatedRows =
      await queryRowsWithPolicyContext<ProfileLocalLoginStateRow>(
        `
      UPDATE profiles
      SET
        fallback_password_set_at = NOW(),
        fallback_password_updated_by = $2::uuid,
        updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING
        id::text AS id,
        email,
        auth_source,
        local_login_enabled,
        local_login_updated_at,
        fallback_password_set_at,
        fallback_password_updated_by::text AS fallback_password_updated_by,
        updated_at
      `,
        [normalizedUserId, normalizedUpdatedBy],
        context
      );

    const newRow = updatedRows[0] || null;
    if (newRow) {
      await publishProfileChangeBestEffort({
        eventType: 'UPDATE',
        oldRow: toProfileRealtimeRow(oldRow),
        newRow: toProfileRealtimeRow(newRow),
      });
    }

    return success(undefined);
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to update fallback password metadata')
    );
  }
}

export async function getUserLocalLoginStateByUserId(
  userId: string,
  context: LocalLoginPolicyContext = SYSTEM_POLICY_CONTEXT
): Promise<Result<UserLocalLoginState | null>> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return failure(new Error('userId is required'));
  }

  try {
    const rows = await queryRowsWithPolicyContext<ProfileLocalLoginStateRow>(
      `
      SELECT
        id::text AS id,
        email,
        auth_source,
        local_login_enabled,
        local_login_updated_at,
        fallback_password_set_at,
        fallback_password_updated_by::text AS fallback_password_updated_by
      FROM profiles
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [normalizedUserId],
      context
    );

    const row = rows[0];
    if (!row) {
      return success(null);
    }

    return success({
      userId: row.id,
      email: row.email ?? null,
      authSource: row.auth_source ?? null,
      localLoginEnabled: Boolean(row.local_login_enabled),
      localLoginUpdatedAt: toIsoString(row.local_login_updated_at),
      fallbackPasswordSetAt: toIsoString(row.fallback_password_set_at),
      fallbackPasswordUpdatedBy: row.fallback_password_updated_by ?? null,
    });
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to get user local-login state')
    );
  }
}

export async function setUserLocalLoginEnabledByUserId(
  userId: string,
  enabled: boolean,
  context: LocalLoginPolicyContext = SYSTEM_POLICY_CONTEXT
): Promise<Result<UserLocalLoginState | null>> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return failure(new Error('userId is required'));
  }

  try {
    const oldRow = await loadProfileRealtimeRowByUserId(
      normalizedUserId,
      context
    );
    const rows = await queryRowsWithPolicyContext<ProfileLocalLoginStateRow>(
      `
      UPDATE profiles
      SET
        local_login_enabled = $2,
        local_login_updated_at = NOW(),
        updated_at = NOW()
      WHERE id = $1::uuid
      RETURNING
        id::text AS id,
        email,
        auth_source,
        local_login_enabled,
        local_login_updated_at,
        fallback_password_set_at,
        fallback_password_updated_by::text AS fallback_password_updated_by,
        updated_at
      `,
      [normalizedUserId, enabled],
      context
    );

    const row = rows[0];
    if (!row) {
      return success(null);
    }

    await publishProfileChangeBestEffort({
      eventType: 'UPDATE',
      oldRow: toProfileRealtimeRow(oldRow),
      newRow: toProfileRealtimeRow(row),
    });

    return success({
      userId: row.id,
      email: row.email ?? null,
      authSource: row.auth_source ?? null,
      localLoginEnabled: Boolean(row.local_login_enabled),
      localLoginUpdatedAt: toIsoString(row.local_login_updated_at),
      fallbackPasswordSetAt: toIsoString(row.fallback_password_set_at),
      fallbackPasswordUpdatedBy: row.fallback_password_updated_by ?? null,
    });
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to update user local-login state')
    );
  }
}

export async function evaluateLocalLoginByEmail(
  rawEmail: string | null | undefined
): Promise<Result<LocalLoginDecision>> {
  const authMode = await getCurrentAuthMode(SYSTEM_POLICY_CONTEXT);
  if (!authMode.success) {
    return failure(authMode.error);
  }

  const email = normalizeEmail(rawEmail);
  if (!email) {
    return success({
      allowed: true,
      authMode: authMode.data,
      email: null,
      userId: null,
      reason: 'email_missing',
    });
  }

  const profileResult = await getProfileByEmail(email, SYSTEM_POLICY_CONTEXT);
  if (!profileResult.success) {
    return failure(profileResult.error);
  }

  const profile = profileResult.data;
  if (!profile) {
    return success({
      allowed: true,
      authMode: authMode.data,
      email,
      userId: null,
      reason: 'profile_not_found',
    });
  }

  const authSource = (profile.auth_source || '').trim().toLowerCase();
  if (isLocalPasswordAuthSource(authSource)) {
    return success({
      allowed: true,
      authMode: authMode.data,
      email,
      userId: profile.id,
      reason: 'password_account',
    });
  }

  if (authMode.data !== 'degraded') {
    return success({
      allowed: false,
      authMode: authMode.data,
      email,
      userId: profile.id,
      reason: 'blocked_auth_mode',
    });
  }

  if (!profile.local_login_enabled) {
    return success({
      allowed: false,
      authMode: authMode.data,
      email,
      userId: profile.id,
      reason: 'blocked_user_toggle',
    });
  }

  const credentialPassword = await hasCredentialPasswordByEmail(
    email,
    SYSTEM_POLICY_CONTEXT
  );
  if (!credentialPassword.success) {
    return failure(credentialPassword.error);
  }

  if (!credentialPassword.data) {
    return success({
      allowed: false,
      authMode: authMode.data,
      email,
      userId: profile.id,
      reason: 'missing_fallback_password',
    });
  }

  return success({
    allowed: true,
    authMode: authMode.data,
    email,
    userId: profile.id,
    reason: 'allowed_degraded',
  });
}

export async function recordLocalLoginAudit(
  input: LocalLoginAuditInput,
  context: LocalLoginPolicyContext = SYSTEM_POLICY_CONTEXT
): Promise<void> {
  try {
    await queryRowsWithPolicyContext(
      `
      INSERT INTO auth_local_login_audit_logs (
        user_id,
        email,
        auth_mode,
        outcome,
        reason,
        status_code,
        ip_address,
        user_agent
      ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id::text
      `,
      [
        input.userId || null,
        normalizeEmail(input.email),
        input.authMode,
        input.outcome,
        input.reason || null,
        input.statusCode ?? null,
        input.ipAddress || null,
        input.userAgent || null,
      ],
      context
    );
  } catch (error) {
    console.warn('[AuthLocalLoginPolicy] failed to insert local-login audit:', {
      error,
      input,
    });
  }
}

export function parseSignInEmailFromRequest(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const value = (payload as Record<string, unknown>).email;
  return normalizeEmail(typeof value === 'string' ? value : null);
}

export function extractClientIp(request: Request): string | null {
  const xForwardedFor = request.headers.get('x-forwarded-for');
  if (xForwardedFor) {
    const firstHop = xForwardedFor.split(',')[0]?.trim();
    if (firstHop) {
      return firstHop;
    }
  }

  const xRealIp = request.headers.get('x-real-ip')?.trim();
  return xRealIp || null;
}
