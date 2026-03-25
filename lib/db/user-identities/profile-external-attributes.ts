import {
  runWithPgSystemContext,
  runWithPgUserContext,
} from '@lib/server/pg/user-context';
import { cacheService } from '@lib/services/db/cache-service';
import { dataService } from '@lib/services/db/data-service';
import { ProfileExternalAttributes } from '@lib/types/identity';
import { Result, failure, success } from '@lib/types/result';

import {
  hasContext,
  normalizeActorUserId,
  normalizeTimestamps,
} from './helpers';
import { queryRowsWithIdentityContext } from './query';
import {
  IdentityPersistenceContext,
  UpsertProfileExternalAttributesInput,
} from './types';

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
