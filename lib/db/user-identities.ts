/**
 * External identity and immutable profile-attribute data access.
 *
 * This module defines the persistence boundary for:
 * - IdP identity mapping (issuer + subject -> user_id)
 * - Enterprise profile attributes synchronized from IdP/HR
 */
import { getPgPool } from '@lib/server/pg/pool';
import {
  queryRowsWithPgSystemContext,
  queryRowsWithPgUserContext,
  runWithPgSystemContext,
  runWithPgUserContext,
} from '@lib/server/pg/user-context';
import { cacheService } from '@lib/services/db/cache-service';
import { dataService } from '@lib/services/db/data-service';
import { ProfileExternalAttributes, UserIdentity } from '@lib/types/identity';
import { Result, failure, success } from '@lib/types/result';

const INTERNAL_AUTH_PROVIDER = 'better-auth';

export interface IdentityPersistenceContext {
  actorUserId?: string | null;
  useSystemActor?: boolean;
}

export interface UpsertUserIdentityInput {
  user_id: string;
  issuer: string;
  provider: string;
  subject: string;
  email?: string | null;
  email_verified?: boolean;
  given_name?: string | null;
  family_name?: string | null;
  preferred_username?: string | null;
  raw_claims?: Record<string, unknown>;
}

export interface UpsertProfileExternalAttributesInput {
  user_id: string;
  source_issuer: string;
  source_provider: string;
  employee_number?: string | null;
  department_code?: string | null;
  department_name?: string | null;
  department_path?: string | null;
  cost_center?: string | null;
  job_title?: string | null;
  employment_type?: string | null;
  manager_employee_number?: string | null;
  manager_name?: string | null;
  phone_e164?: string | null;
  office_location?: string | null;
  hire_date?: string | null;
  attributes?: Record<string, unknown>;
  raw_profile?: Record<string, unknown>;
}

function normalizeIssuer(issuer: string): string {
  return issuer.trim().toLowerCase();
}

function normalizeSubject(subject: string): string {
  return subject.trim();
}

function normalizeProvider(provider: string): string {
  return provider.trim();
}

function normalizeActorUserId(
  userId: string | null | undefined
): string | null {
  if (typeof userId !== 'string') {
    return null;
  }

  const normalized = userId.trim();
  return normalized.length > 0 ? normalized : null;
}

function hasContext(context?: IdentityPersistenceContext): boolean {
  const actorUserId = normalizeActorUserId(context?.actorUserId);
  return Boolean(actorUserId || context?.useSystemActor);
}

async function queryRowsWithIdentityContext<T extends object>(
  sql: string,
  params: unknown[] = [],
  context?: IdentityPersistenceContext
): Promise<T[]> {
  const actorUserId = normalizeActorUserId(context?.actorUserId);
  if (actorUserId) {
    return queryRowsWithPgUserContext<T>(actorUserId, sql, params);
  }

  if (context?.useSystemActor) {
    return queryRowsWithPgSystemContext<T>(sql, params);
  }

  const pool = getPgPool();
  const { rows } = await pool.query<T>(sql, params);
  return rows;
}

function normalizeTimestamps<T extends object>(row: T): T {
  const normalized: Record<string, unknown> = {
    ...(row as Record<string, unknown>),
  };

  const timestampFields = [
    'created_at',
    'updated_at',
    'last_login_at',
    'synced_at',
    'last_seen_at',
  ];

  timestampFields.forEach(field => {
    const value = normalized[field];
    if (value instanceof Date) {
      normalized[field] = value.toISOString();
    }
  });

  return normalized as T;
}

export async function getUserIdentityByIssuerSubject(
  issuer: string,
  subject: string,
  context?: IdentityPersistenceContext
): Promise<Result<UserIdentity | null>> {
  if (!issuer.trim() || !subject.trim()) {
    return success(null);
  }

  const normalizedIssuer = normalizeIssuer(issuer);
  const normalizedSubject = normalizeSubject(subject);

  if (!hasContext(context)) {
    return dataService.findOne<UserIdentity>(
      'user_identities',
      {
        issuer: normalizedIssuer,
        subject: normalizedSubject,
      },
      {
        cache: true,
        cacheTTL: 5 * 60 * 1000,
      }
    );
  }

  try {
    const rows = await queryRowsWithIdentityContext<UserIdentity>(
      `
        SELECT *
        FROM user_identities
        WHERE issuer = $1
          AND subject = $2
        LIMIT 1
      `,
      [normalizedIssuer, normalizedSubject],
      context
    );

    const row = rows[0];
    return success(row ? normalizeTimestamps(row) : null);
  } catch (error) {
    return failure(
      error instanceof Error ? error : new Error('Failed to load user identity')
    );
  }
}

export async function getUserIdentitiesByUserId(
  userId: string,
  options?: {
    cache?: boolean;
  },
  context?: IdentityPersistenceContext
): Promise<Result<UserIdentity[]>> {
  if (!userId.trim()) {
    return success([]);
  }

  const useCache = options?.cache ?? true;

  if (!hasContext(context)) {
    return dataService.findMany<UserIdentity>(
      'user_identities',
      { user_id: userId },
      { column: 'updated_at', ascending: false },
      undefined,
      {
        cache: useCache,
        cacheTTL: 2 * 60 * 1000,
      }
    );
  }

  try {
    const rows = await queryRowsWithIdentityContext<UserIdentity>(
      `
        SELECT *
        FROM user_identities
        WHERE user_id = $1::uuid
        ORDER BY updated_at DESC
      `,
      [userId],
      context
    );

    return success(rows.map(row => normalizeTimestamps(row)));
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to load user identities by user id')
    );
  }
}

export async function upsertUserIdentity(
  input: UpsertUserIdentityInput,
  context?: IdentityPersistenceContext
): Promise<Result<UserIdentity>> {
  const issuer = normalizeIssuer(input.issuer);
  const subject = normalizeSubject(input.subject);
  const provider = normalizeProvider(input.provider);
  const userId = input.user_id.trim();

  if (!userId || !issuer || !subject || !provider) {
    return failure(
      new Error(
        'upsertUserIdentity requires user_id, issuer, provider, and subject'
      )
    );
  }

  // Enforce one-to-one ownership: one internal UUID can only bind one IdP identity.
  const existingByUser = await getUserIdentitiesByUserId(
    userId,
    {
      cache: false,
    },
    context
  );
  if (!existingByUser.success) {
    return failure(existingByUser.error);
  }

  const existingIdentity = existingByUser.data[0];
  if (
    existingIdentity &&
    (existingIdentity.issuer !== issuer || existingIdentity.subject !== subject)
  ) {
    return failure(
      new Error(
        `User ${userId} is already bound to identity ${existingIdentity.issuer}:${existingIdentity.subject}`
      )
    );
  }

  if (existingIdentity) {
    const existingProvider = normalizeProvider(existingIdentity.provider);
    const existingIsInternal = existingProvider === INTERNAL_AUTH_PROVIDER;
    const incomingIsInternal = provider === INTERNAL_AUTH_PROVIDER;

    if (
      !existingIsInternal &&
      !incomingIsInternal &&
      existingProvider !== provider
    ) {
      return failure(
        new Error(
          `User ${userId} is already bound to IdP provider ${existingProvider}`
        )
      );
    }
  }

  const upsertSql = `
    INSERT INTO user_identities (
      user_id,
      issuer,
      provider,
      subject,
      email,
      email_verified,
      given_name,
      family_name,
      preferred_username,
      raw_claims,
      last_login_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, NOW()
    )
    ON CONFLICT (issuer, subject)
    DO UPDATE SET
      -- Keep the original owner for a given external identity to avoid
      -- accidental reassignment under concurrent first-login races.
      -- Keep existing external provider when the fallback local login path
      -- reports an internal provider.
      provider = CASE
        WHEN EXCLUDED.provider = '${INTERNAL_AUTH_PROVIDER}'
        THEN user_identities.provider
        ELSE EXCLUDED.provider
      END,
      email = EXCLUDED.email,
      email_verified = EXCLUDED.email_verified,
      given_name = EXCLUDED.given_name,
      family_name = EXCLUDED.family_name,
      preferred_username = EXCLUDED.preferred_username,
      raw_claims = EXCLUDED.raw_claims,
      last_login_at = NOW(),
      updated_at = NOW()
    RETURNING *
  `;

  const upsertParams = [
    userId,
    issuer,
    provider,
    subject,
    input.email ?? null,
    input.email_verified ?? false,
    input.given_name ?? null,
    input.family_name ?? null,
    input.preferred_username ?? null,
    JSON.stringify(input.raw_claims ?? {}),
  ];

  let rows: UserIdentity[] = [];
  try {
    if (!hasContext(context)) {
      const queryResult = await dataService.rawQuery<UserIdentity>(
        upsertSql,
        upsertParams
      );
      if (!queryResult.success) {
        throw queryResult.error;
      }
      rows = queryResult.data;
    } else {
      rows = await queryRowsWithIdentityContext<UserIdentity>(
        upsertSql,
        upsertParams,
        context
      );
    }
  } catch (error) {
    const dbError = error as Error & { code?: string };
    const isUserIdUniqueViolation =
      dbError.code === '23505' &&
      dbError.message.includes('idx_user_identities_user_id_unique');

    if (isUserIdUniqueViolation) {
      const reloadedByUser = await getUserIdentitiesByUserId(
        userId,
        {
          cache: false,
        },
        context
      );
      if (!reloadedByUser.success) {
        return failure(dbError);
      }

      const reloadedIdentity = reloadedByUser.data[0];
      if (
        reloadedIdentity &&
        (reloadedIdentity.issuer !== issuer ||
          reloadedIdentity.subject !== subject)
      ) {
        return failure(
          new Error(
            `User ${userId} is already bound to identity ${reloadedIdentity.issuer}:${reloadedIdentity.subject}`
          )
        );
      }
    }

    return failure(dbError);
  }

  const row = rows[0];
  if (!row) {
    return failure(new Error('Failed to upsert user identity'));
  }

  cacheService.deletePattern('user_identities:*');
  return success(normalizeTimestamps(row));
}

export async function getProfileExternalAttributes(
  userId: string,
  context?: IdentityPersistenceContext
): Promise<Result<ProfileExternalAttributes | null>> {
  if (!userId.trim()) {
    return success(null);
  }

  if (!hasContext(context)) {
    return dataService.findOne<ProfileExternalAttributes>(
      'profile_external_attributes',
      { user_id: userId },
      {
        cache: true,
        cacheTTL: 5 * 60 * 1000,
      }
    );
  }

  try {
    const rows = await queryRowsWithIdentityContext<ProfileExternalAttributes>(
      `
        SELECT *
        FROM profile_external_attributes
        WHERE user_id = $1::uuid
        LIMIT 1
      `,
      [userId],
      context
    );

    const row = rows[0];
    return success(row ? normalizeTimestamps(row) : null);
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to load profile external attributes')
    );
  }
}

export async function upsertProfileExternalAttributes(
  input: UpsertProfileExternalAttributesInput,
  context?: IdentityPersistenceContext
): Promise<Result<ProfileExternalAttributes>> {
  if (
    !input.user_id.trim() ||
    !input.source_issuer.trim() ||
    !input.source_provider.trim()
  ) {
    return failure(
      new Error(
        'upsertProfileExternalAttributes requires user_id, source_issuer, and source_provider'
      )
    );
  }

  const upsertSql = `
    INSERT INTO profile_external_attributes (
      user_id,
      source_issuer,
      source_provider,
      employee_number,
      department_code,
      department_name,
      department_path,
      cost_center,
      job_title,
      employment_type,
      manager_employee_number,
      manager_name,
      phone_e164,
      office_location,
      hire_date,
      attributes,
      raw_profile,
      synced_at,
      last_seen_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
      $15::date, $16::jsonb, $17::jsonb, NOW(), NOW()
    )
    ON CONFLICT (user_id)
    DO UPDATE SET
      source_issuer = EXCLUDED.source_issuer,
      source_provider = EXCLUDED.source_provider,
      employee_number = EXCLUDED.employee_number,
      department_code = EXCLUDED.department_code,
      department_name = EXCLUDED.department_name,
      department_path = EXCLUDED.department_path,
      cost_center = EXCLUDED.cost_center,
      job_title = EXCLUDED.job_title,
      employment_type = EXCLUDED.employment_type,
      manager_employee_number = EXCLUDED.manager_employee_number,
      manager_name = EXCLUDED.manager_name,
      phone_e164 = EXCLUDED.phone_e164,
      office_location = EXCLUDED.office_location,
      hire_date = EXCLUDED.hire_date,
      attributes = EXCLUDED.attributes,
      raw_profile = EXCLUDED.raw_profile,
      synced_at = NOW(),
      last_seen_at = NOW(),
      updated_at = NOW()
    RETURNING *
  `;

  const upsertParams = [
    input.user_id,
    input.source_issuer.trim().toLowerCase(),
    input.source_provider.trim(),
    input.employee_number ?? null,
    input.department_code ?? null,
    input.department_name ?? null,
    input.department_path ?? null,
    input.cost_center ?? null,
    input.job_title ?? null,
    input.employment_type ?? null,
    input.manager_employee_number ?? null,
    input.manager_name ?? null,
    input.phone_e164 ?? null,
    input.office_location ?? null,
    input.hire_date ?? null,
    JSON.stringify(input.attributes ?? {}),
    JSON.stringify(input.raw_profile ?? {}),
  ];

  if (!hasContext(context)) {
    const txResult =
      await dataService.runInTransaction<ProfileExternalAttributes>(
        async client => {
          // Mark this transaction as identity-sync path so immutable-guard trigger allows updates.
          await client.query(`SET LOCAL app.identity_sync = 'true'`);

          const queryResult = await client.query<ProfileExternalAttributes>(
            upsertSql,
            upsertParams
          );

          const row = queryResult.rows[0];
          if (!row) {
            throw new Error('Failed to upsert profile external attributes');
          }

          return normalizeTimestamps(row);
        }
      );

    if (!txResult.success) {
      return failure(txResult.error);
    }

    cacheService.deletePattern('profile_external_attributes:*');
    return success(txResult.data);
  }

  const actorUserId = normalizeActorUserId(context?.actorUserId);

  try {
    const row = actorUserId
      ? await runWithPgUserContext(actorUserId, async client => {
          await client.query(`SET LOCAL app.identity_sync = 'true'`);
          const queryResult = await client.query<ProfileExternalAttributes>(
            upsertSql,
            upsertParams
          );
          return queryResult.rows[0] || null;
        })
      : await runWithPgSystemContext(async client => {
          await client.query(`SET LOCAL app.identity_sync = 'true'`);
          const queryResult = await client.query<ProfileExternalAttributes>(
            upsertSql,
            upsertParams
          );
          return queryResult.rows[0] || null;
        });

    if (!row) {
      return failure(new Error('Failed to upsert profile external attributes'));
    }

    cacheService.deletePattern('profile_external_attributes:*');
    return success(normalizeTimestamps(row));
  } catch (error) {
    return failure(
      error instanceof Error
        ? error
        : new Error('Failed to upsert profile external attributes')
    );
  }
}
