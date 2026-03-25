import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import type { GroupMembershipSummaryRow } from './types';

export async function loadGroupsByUserIdMap(
  userIds: string[]
): Promise<Map<string, Array<Record<string, unknown>>>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const rows = await queryRowsWithPgSystemContext<GroupMembershipSummaryRow>(
    `
      SELECT
        gm.user_id::text AS user_id,
        gm.created_at::text AS joined_at,
        g.id::text AS group_id,
        g.name AS group_name,
        g.description AS group_description
      FROM group_members gm
      INNER JOIN groups g ON g.id = gm.group_id
      WHERE gm.user_id = ANY($1::uuid[])
      ORDER BY gm.created_at DESC
    `,
    [userIds]
  );

  const groupsByUser = new Map<string, Array<Record<string, unknown>>>();
  rows.forEach(row => {
    const current = groupsByUser.get(row.user_id) || [];
    current.push({
      id: row.group_id,
      name: row.group_name,
      description: row.group_description || null,
      joined_at: row.joined_at,
    });
    groupsByUser.set(row.user_id, current);
  });
  return groupsByUser;
}

export async function ensureProviderDefaultServiceInstance(
  providerId: string,
  options: { preferredId?: string | null; excludeId?: string | null } = {}
): Promise<string | null> {
  const existingDefaultRows = await queryRowsWithPgSystemContext<{
    id: string;
  }>(
    `
      SELECT id::text
      FROM service_instances
      WHERE provider_id = $1::uuid
        AND is_default = TRUE
      LIMIT 1
    `,
    [providerId]
  );
  if (existingDefaultRows[0]?.id) {
    return existingDefaultRows[0].id;
  }

  const preferredId = (options.preferredId || '').trim();
  const excludeId = (options.excludeId || '').trim();

  let targetId: string | null = null;
  if (preferredId && preferredId !== excludeId) {
    const preferredRows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        SELECT id::text
        FROM service_instances
        WHERE provider_id = $1::uuid
          AND id = $2::uuid
        LIMIT 1
      `,
      [providerId, preferredId]
    );
    targetId = preferredRows[0]?.id || null;
  }

  if (!targetId) {
    const fallbackRows = excludeId
      ? await queryRowsWithPgSystemContext<{ id: string }>(
          `
            SELECT id::text
            FROM service_instances
            WHERE provider_id = $1::uuid
              AND id <> $2::uuid
            ORDER BY created_at ASC, id ASC
            LIMIT 1
          `,
          [providerId, excludeId]
        )
      : await queryRowsWithPgSystemContext<{ id: string }>(
          `
            SELECT id::text
            FROM service_instances
            WHERE provider_id = $1::uuid
            ORDER BY created_at ASC, id ASC
            LIMIT 1
          `,
          [providerId]
        );
    targetId = fallbackRows[0]?.id || null;
  }

  if (!targetId) {
    return null;
  }

  await queryRowsWithPgSystemContext(
    `
      UPDATE service_instances
      SET is_default = TRUE, updated_at = NOW()
      WHERE id = $1::uuid
    `,
    [targetId]
  );

  return targetId;
}
