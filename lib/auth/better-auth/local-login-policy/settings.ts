import { Result, failure, success } from '@lib/types/result';

import { SYSTEM_POLICY_CONTEXT, queryRowsWithPolicyContext } from './context';
import { normalizeAuthMode, toIsoString } from './helpers';
import {
  loadProfileRealtimeRowByUserId,
  publishProfileChangeBestEffort,
  toProfileRealtimeRow,
} from './realtime';
import type {
  AuthMode,
  AuthModeRow,
  CredentialPasswordExistsRow,
  LocalLoginPolicyContext,
  ProfileLocalLoginRow,
  ProfileLocalLoginStateRow,
  UserLocalLoginState,
} from './types';

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
  if (authMode !== 'normal' && authMode !== 'degraded') {
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

export async function getProfileByEmail(
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

export { getCurrentAuthMode, hasCredentialPasswordByEmail };
