/**
 * External identity and immutable profile-attribute data access.
 *
 * This module defines the persistence boundary for:
 * - IdP identity mapping (issuer + subject -> user_id)
 * - Enterprise profile attributes synchronized from IdP/HR
 */
import { cacheService } from '@lib/services/db/cache-service';
import { dataService } from '@lib/services/db/data-service';
import { ProfileExternalAttributes, UserIdentity } from '@lib/types/identity';
import { Result, failure, success } from '@lib/types/result';

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
  subject: string
): Promise<Result<UserIdentity | null>> {
  if (!issuer.trim() || !subject.trim()) {
    return success(null);
  }

  return dataService.findOne<UserIdentity>(
    'user_identities',
    {
      issuer: normalizeIssuer(issuer),
      subject: normalizeSubject(subject),
    },
    {
      cache: true,
      cacheTTL: 5 * 60 * 1000,
    }
  );
}

export async function getUserIdentitiesByUserId(
  userId: string
): Promise<Result<UserIdentity[]>> {
  if (!userId.trim()) {
    return success([]);
  }

  return dataService.findMany<UserIdentity>(
    'user_identities',
    { user_id: userId },
    { column: 'updated_at', ascending: false },
    undefined,
    {
      cache: true,
      cacheTTL: 2 * 60 * 1000,
    }
  );
}

export async function upsertUserIdentity(
  input: UpsertUserIdentityInput
): Promise<Result<UserIdentity>> {
  const issuer = normalizeIssuer(input.issuer);
  const subject = normalizeSubject(input.subject);
  const provider = normalizeProvider(input.provider);

  if (!input.user_id.trim() || !issuer || !subject || !provider) {
    return failure(
      new Error(
        'upsertUserIdentity requires user_id, issuer, provider, and subject'
      )
    );
  }

  const queryResult = await dataService.rawQuery<UserIdentity>(
    `
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
        user_id = EXCLUDED.user_id,
        provider = EXCLUDED.provider,
        email = EXCLUDED.email,
        email_verified = EXCLUDED.email_verified,
        given_name = EXCLUDED.given_name,
        family_name = EXCLUDED.family_name,
        preferred_username = EXCLUDED.preferred_username,
        raw_claims = EXCLUDED.raw_claims,
        last_login_at = NOW(),
        updated_at = NOW()
      RETURNING *
    `,
    [
      input.user_id,
      issuer,
      provider,
      subject,
      input.email ?? null,
      input.email_verified ?? false,
      input.given_name ?? null,
      input.family_name ?? null,
      input.preferred_username ?? null,
      JSON.stringify(input.raw_claims ?? {}),
    ]
  );

  if (!queryResult.success) {
    return failure(queryResult.error);
  }

  const row = queryResult.data[0];
  if (!row) {
    return failure(new Error('Failed to upsert user identity'));
  }

  cacheService.deletePattern('user_identities:*');
  return success(normalizeTimestamps(row));
}

export async function getProfileExternalAttributes(
  userId: string
): Promise<Result<ProfileExternalAttributes | null>> {
  if (!userId.trim()) {
    return success(null);
  }

  return dataService.findOne<ProfileExternalAttributes>(
    'profile_external_attributes',
    { user_id: userId },
    {
      cache: true,
      cacheTTL: 5 * 60 * 1000,
    }
  );
}

export async function upsertProfileExternalAttributes(
  input: UpsertProfileExternalAttributesInput
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

  const txResult =
    await dataService.runInTransaction<ProfileExternalAttributes>(
      async client => {
        // Mark this transaction as identity-sync path so immutable-guard trigger allows updates.
        await client.query(`SET LOCAL app.identity_sync = 'true'`);

        const queryResult = await client.query<ProfileExternalAttributes>(
          `
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
        `,
          [
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
          ]
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
