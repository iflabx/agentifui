import { getPgPool } from '@lib/server/pg/pool';
import { Result, failure, success } from '@lib/types/result';

export type AuthMode = 'normal' | 'degraded';

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
};

export type LocalLoginDecisionReason =
  | 'email_missing'
  | 'profile_not_found'
  | 'password_account'
  | 'blocked_auth_mode'
  | 'blocked_user_toggle'
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

function normalizeAuthMode(input: string | null | undefined): AuthMode {
  if (input === 'degraded') {
    return 'degraded';
  }

  return 'normal';
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

async function getCurrentAuthMode(): Promise<Result<AuthMode>> {
  const pool = getPgPool();

  try {
    const query = await pool.query<AuthModeRow>(
      `
      SELECT auth_mode
      FROM auth_settings
      ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
      LIMIT 1
      `
    );

    return success(normalizeAuthMode(query.rows[0]?.auth_mode));
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to load current auth mode')
    );
  }
}

export async function getAuthModeSetting(): Promise<Result<AuthMode>> {
  return getCurrentAuthMode();
}

export async function setAuthModeSetting(
  authMode: AuthMode
): Promise<Result<AuthMode>> {
  if (!isAuthMode(authMode)) {
    return failure(new Error('Invalid auth mode'));
  }

  const pool = getPgPool();

  try {
    const updated = await pool.query<AuthModeRow>(
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
      [authMode]
    );

    if (updated.rows[0]) {
      return success(normalizeAuthMode(updated.rows[0].auth_mode));
    }

    const inserted = await pool.query<AuthModeRow>(
      `
      INSERT INTO auth_settings (auth_mode, created_at, updated_at)
      VALUES ($1, NOW(), NOW())
      RETURNING auth_mode
      `,
      [authMode]
    );

    return success(normalizeAuthMode(inserted.rows[0]?.auth_mode));
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to update auth mode setting')
    );
  }
}

async function getProfileByEmail(
  email: string
): Promise<Result<ProfileLocalLoginRow | null>> {
  const pool = getPgPool();

  try {
    const query = await pool.query<ProfileLocalLoginRow>(
      `
      SELECT
        id::text AS id,
        auth_source,
        local_login_enabled
      FROM profiles
      WHERE lower(email) = $1
      LIMIT 1
      `,
      [email]
    );

    return success(query.rows[0] ?? null);
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to load profile by email')
    );
  }
}

export async function getUserLocalLoginStateByUserId(
  userId: string
): Promise<Result<UserLocalLoginState | null>> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return failure(new Error('userId is required'));
  }

  const pool = getPgPool();
  try {
    const query = await pool.query<ProfileLocalLoginStateRow>(
      `
      SELECT
        id::text AS id,
        email,
        auth_source,
        local_login_enabled,
        local_login_updated_at
      FROM profiles
      WHERE id = $1::uuid
      LIMIT 1
      `,
      [normalizedUserId]
    );

    const row = query.rows[0];
    if (!row) {
      return success(null);
    }

    return success({
      userId: row.id,
      email: row.email ?? null,
      authSource: row.auth_source ?? null,
      localLoginEnabled: Boolean(row.local_login_enabled),
      localLoginUpdatedAt: toIsoString(row.local_login_updated_at),
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
  enabled: boolean
): Promise<Result<UserLocalLoginState | null>> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return failure(new Error('userId is required'));
  }

  const pool = getPgPool();
  try {
    const query = await pool.query<ProfileLocalLoginStateRow>(
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
        local_login_updated_at
      `,
      [normalizedUserId, enabled]
    );

    const row = query.rows[0];
    if (!row) {
      return success(null);
    }

    return success({
      userId: row.id,
      email: row.email ?? null,
      authSource: row.auth_source ?? null,
      localLoginEnabled: Boolean(row.local_login_enabled),
      localLoginUpdatedAt: toIsoString(row.local_login_updated_at),
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
  const authMode = await getCurrentAuthMode();
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

  const profileResult = await getProfileByEmail(email);
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
  if (!authSource || authSource === 'password') {
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

  return success({
    allowed: true,
    authMode: authMode.data,
    email,
    userId: profile.id,
    reason: 'allowed_degraded',
  });
}

export async function recordLocalLoginAudit(
  input: LocalLoginAuditInput
): Promise<void> {
  const pool = getPgPool();

  try {
    await pool.query(
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
      ]
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
