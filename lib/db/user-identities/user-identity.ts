import { cacheService } from '@lib/services/db/cache-service';
import { dataService } from '@lib/services/db/data-service';
import { UserIdentity } from '@lib/types/identity';
import { Result, failure, success } from '@lib/types/result';

import {
  hasContext,
  normalizeIssuer,
  normalizeProvider,
  normalizeSubject,
  normalizeTimestamps,
} from './helpers';
import { queryRowsWithIdentityContext } from './query';
import {
  INTERNAL_AUTH_PROVIDER,
  IdentityPersistenceContext,
  UpsertUserIdentityInput,
} from './types';

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
