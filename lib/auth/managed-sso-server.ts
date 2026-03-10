import { queryRowsWithPgSystemContext } from '@lib/server/pg/user-context';
import { SsoProvider } from '@lib/types/database';

export async function listManagedSsoProvidersForLogin(): Promise<
  SsoProvider[]
> {
  return queryRowsWithPgSystemContext<SsoProvider>(
    `
      SELECT *
      FROM sso_providers
      WHERE enabled = TRUE
      ORDER BY display_order ASC, id ASC
    `
  );
}

export async function getManagedSsoProviderForLoginById(
  id: string
): Promise<SsoProvider | null> {
  try {
    const rows = await queryRowsWithPgSystemContext<SsoProvider>(
      `
        SELECT *
        FROM sso_providers
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [id]
    );

    return rows[0] || null;
  } catch {
    return null;
  }
}
