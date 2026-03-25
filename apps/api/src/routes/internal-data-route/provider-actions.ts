import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import {
  readBoolean,
  readObject,
  readString,
  sanitizeProviderRow,
  toErrorResponse,
  toSuccessResponse,
} from './helpers';
import {
  type ApiActionResponse,
  LOCAL_PROVIDER_ACTIONS,
  type ProviderRow,
} from './types';

export async function handleProviderAction(
  action: string,
  payload: Record<string, unknown> | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_PROVIDER_ACTIONS.has(action)) {
    return null;
  }

  if (
    action === 'providers.getAllProviders' ||
    action === 'providers.getActiveProviders'
  ) {
    const sql =
      action === 'providers.getActiveProviders'
        ? `
            SELECT
              id::text,
              name,
              type,
              base_url,
              auth_type,
              is_active,
              is_default,
              created_at::text,
              updated_at::text
            FROM providers
            WHERE is_active = TRUE
            ORDER BY name ASC
          `
        : `
            SELECT
              id::text,
              name,
              type,
              base_url,
              auth_type,
              is_active,
              is_default,
              created_at::text,
              updated_at::text
            FROM providers
            ORDER BY name ASC
          `;
    const rows = await queryRowsWithPgSystemContext<ProviderRow>(sql);
    return toSuccessResponse(rows.map(sanitizeProviderRow));
  }

  if (action === 'providers.createProvider') {
    const provider = readObject(payload?.provider);
    const name = readString(provider.name);
    const type = readString(provider.type);
    const baseUrl = readString(provider.base_url);
    const authType = readString(provider.auth_type);
    if (!name || !type || !baseUrl || !authType) {
      return toErrorResponse('Missing required fields', 400);
    }

    const rows = await queryRowsWithPgSystemContext<ProviderRow>(
      `
        INSERT INTO providers (
          name,
          type,
          base_url,
          auth_type,
          is_active,
          is_default,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING
          id::text,
          name,
          type,
          base_url,
          auth_type,
          is_active,
          is_default,
          created_at::text,
          updated_at::text
      `,
      [
        name,
        type,
        baseUrl,
        authType,
        readBoolean(provider.is_active, true),
        readBoolean(provider.is_default, false),
      ]
    );

    return toSuccessResponse(rows[0] ? sanitizeProviderRow(rows[0]) : null);
  }

  if (action === 'providers.updateProvider') {
    const providerId = readString(payload?.id);
    const updates = readObject(payload?.updates);
    if (!providerId) {
      return toErrorResponse('Missing id', 400);
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    const addSet = (column: string, value: unknown) => {
      setClauses.push(`${column} = $${index}`);
      values.push(value);
      index += 1;
    };

    if (Object.prototype.hasOwnProperty.call(updates, 'name')) {
      addSet('name', readString(updates.name) || null);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'type')) {
      addSet('type', readString(updates.type) || null);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'base_url')) {
      addSet('base_url', readString(updates.base_url) || null);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'auth_type')) {
      addSet('auth_type', readString(updates.auth_type) || null);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'is_active')) {
      addSet('is_active', readBoolean(updates.is_active, false));
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'is_default')) {
      addSet('is_default', readBoolean(updates.is_default, false));
    }

    if (setClauses.length === 0) {
      return toErrorResponse('No fields to update', 400);
    }

    setClauses.push('updated_at = NOW()');
    values.push(providerId);

    const rows = await queryRowsWithPgSystemContext<ProviderRow>(
      `
        UPDATE providers
        SET ${setClauses.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING
          id::text,
          name,
          type,
          base_url,
          auth_type,
          is_active,
          is_default,
          created_at::text,
          updated_at::text
      `,
      values
    );

    if (!rows[0]) {
      return toErrorResponse('Provider not found', 404);
    }
    return toSuccessResponse(sanitizeProviderRow(rows[0]));
  }

  if (action === 'providers.deleteProvider') {
    const providerId = readString(payload?.id);
    if (!providerId) {
      return toErrorResponse('Missing id', 400);
    }

    const rows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        DELETE FROM providers
        WHERE id = $1::uuid
        RETURNING id::text
      `,
      [providerId]
    );
    return toSuccessResponse(Boolean(rows[0]?.id));
  }

  return null;
}
