import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import {
  encryptApiKeyValue,
  readBoolean,
  readObject,
  readString,
  sanitizeApiKeyRow,
  toErrorResponse,
  toSuccessResponse,
} from './helpers';
import {
  type ApiActionResponse,
  type ApiKeyRow,
  LOCAL_API_KEY_ACTIONS,
} from './types';

export async function handleApiKeyAction(
  action: string,
  payload: Record<string, unknown> | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_API_KEY_ACTIONS.has(action)) {
    return null;
  }

  if (action === 'apiKeys.getByServiceInstance') {
    const serviceInstanceId = readString(payload?.serviceInstanceId);
    if (!serviceInstanceId) {
      return toErrorResponse('Missing serviceInstanceId', 400);
    }

    const rows = await queryRowsWithPgSystemContext<ApiKeyRow>(
      `
        SELECT
          id::text,
          provider_id::text,
          service_instance_id::text,
          user_id::text,
          key_value,
          is_default,
          usage_count,
          last_used_at::text,
          created_at::text,
          updated_at::text
        FROM api_keys
        WHERE service_instance_id = $1::uuid
          AND is_default = TRUE
        LIMIT 1
      `,
      [serviceInstanceId]
    );

    return toSuccessResponse(rows[0] ? sanitizeApiKeyRow(rows[0]) : null);
  }

  if (action === 'apiKeys.create') {
    const apiKey = readObject(payload?.apiKey);
    const keyValue = readString(apiKey.key_value);
    if (!keyValue) {
      return toErrorResponse('Missing key_value', 400);
    }

    const isEncrypted = readBoolean(payload?.isEncrypted, false);
    let storedKeyValue = keyValue;
    if (!isEncrypted) {
      const masterKey = process.env.API_ENCRYPTION_KEY;
      if (!masterKey) {
        return toErrorResponse(
          'API_ENCRYPTION_KEY environment variable is not set, cannot encrypt API key',
          500
        );
      }
      storedKeyValue = encryptApiKeyValue(keyValue, masterKey);
    }

    const rows = await queryRowsWithPgSystemContext<ApiKeyRow>(
      `
        INSERT INTO api_keys (
          provider_id,
          service_instance_id,
          user_id,
          key_value,
          is_default,
          usage_count,
          last_used_at,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4,
          $5,
          $6,
          $7::timestamptz,
          NOW(),
          NOW()
        )
        RETURNING
          id::text,
          provider_id::text,
          service_instance_id::text,
          user_id::text,
          key_value,
          is_default,
          usage_count,
          last_used_at::text,
          created_at::text,
          updated_at::text
      `,
      [
        readString(apiKey.provider_id) || null,
        readString(apiKey.service_instance_id) || null,
        readString(apiKey.user_id) || null,
        storedKeyValue,
        readBoolean(apiKey.is_default, false),
        typeof apiKey.usage_count === 'number' &&
        Number.isFinite(apiKey.usage_count)
          ? Math.max(0, Math.floor(apiKey.usage_count))
          : 0,
        readString(apiKey.last_used_at) || null,
      ]
    );

    return toSuccessResponse(rows[0] ? sanitizeApiKeyRow(rows[0]) : null);
  }

  if (action === 'apiKeys.update') {
    const id = readString(payload?.id);
    const updates = readObject(payload?.updates);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    const isEncrypted = readBoolean(payload?.isEncrypted, false);
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    const addSet = (fragment: string, value: unknown) => {
      setClauses.push(`${fragment} = $${index}`);
      values.push(value);
      index += 1;
    };

    if (Object.prototype.hasOwnProperty.call(updates, 'provider_id')) {
      setClauses.push(`provider_id = $${index}::uuid`);
      values.push(readString(updates.provider_id) || null);
      index += 1;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'service_instance_id')) {
      setClauses.push(`service_instance_id = $${index}::uuid`);
      values.push(readString(updates.service_instance_id) || null);
      index += 1;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'user_id')) {
      setClauses.push(`user_id = $${index}::uuid`);
      values.push(readString(updates.user_id) || null);
      index += 1;
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'key_value')) {
      const rawKeyValue = readString(updates.key_value);
      if (!rawKeyValue) {
        return toErrorResponse('Invalid key_value', 400);
      }
      if (isEncrypted) {
        addSet('key_value', rawKeyValue);
      } else {
        const masterKey = process.env.API_ENCRYPTION_KEY;
        if (!masterKey) {
          return toErrorResponse(
            'API_ENCRYPTION_KEY environment variable is not set, cannot encrypt API key',
            500
          );
        }
        addSet('key_value', encryptApiKeyValue(rawKeyValue, masterKey));
      }
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'is_default')) {
      addSet('is_default', readBoolean(updates.is_default, false));
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'usage_count')) {
      const usageCount =
        typeof updates.usage_count === 'number' &&
        Number.isFinite(updates.usage_count)
          ? Math.max(0, Math.floor(updates.usage_count))
          : 0;
      addSet('usage_count', usageCount);
    }
    if (Object.prototype.hasOwnProperty.call(updates, 'last_used_at')) {
      setClauses.push(`last_used_at = $${index}::timestamptz`);
      values.push(readString(updates.last_used_at) || null);
      index += 1;
    }

    if (setClauses.length === 0) {
      return toErrorResponse('No fields to update', 400);
    }

    setClauses.push('updated_at = NOW()');
    values.push(id);

    const rows = await queryRowsWithPgSystemContext<ApiKeyRow>(
      `
        UPDATE api_keys
        SET ${setClauses.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING
          id::text,
          provider_id::text,
          service_instance_id::text,
          user_id::text,
          key_value,
          is_default,
          usage_count,
          last_used_at::text,
          created_at::text,
          updated_at::text
      `,
      values
    );

    if (!rows[0]) {
      return toErrorResponse('API key not found', 404);
    }
    return toSuccessResponse(sanitizeApiKeyRow(rows[0]));
  }

  if (action === 'apiKeys.delete') {
    const id = readString(payload?.id);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    const rows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        DELETE FROM api_keys
        WHERE id = $1::uuid
        RETURNING id::text
      `,
      [id]
    );
    return toSuccessResponse(Boolean(rows[0]?.id));
  }

  return null;
}
