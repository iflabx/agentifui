import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import { ensureProviderDefaultServiceInstance } from './domain-helpers';
import {
  normalizeNullableTextValue,
  parseAppVisibility,
  readBoolean,
  readObject,
  readString,
  sanitizeServiceInstanceRow,
  toErrorResponse,
  toSuccessResponse,
} from './helpers';
import {
  type ApiActionResponse,
  LOCAL_SERVICE_INSTANCE_ACTIONS,
  SERVICE_INSTANCE_UPDATE_COLUMNS,
  type ServiceInstanceRow,
} from './types';

export async function handleServiceInstanceAction(
  action: string,
  payload: Record<string, unknown> | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_SERVICE_INSTANCE_ACTIONS.has(action)) {
    return null;
  }

  if (action === 'serviceInstances.getByProvider') {
    const providerId = readString(payload?.providerId);
    if (!providerId) {
      return toErrorResponse('Missing providerId', 400);
    }
    const rows = await queryRowsWithPgSystemContext<ServiceInstanceRow>(
      `
        SELECT
          id::text,
          provider_id::text,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility::text,
          config,
          created_at::text,
          updated_at::text
        FROM service_instances
        WHERE provider_id = $1::uuid
        ORDER BY display_name ASC NULLS LAST
      `,
      [providerId]
    );
    return toSuccessResponse(rows.map(sanitizeServiceInstanceRow));
  }

  if (action === 'serviceInstances.getById') {
    const id = readString(payload?.id);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    const rows = await queryRowsWithPgSystemContext<ServiceInstanceRow>(
      `
        SELECT
          id::text,
          provider_id::text,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility::text,
          config,
          created_at::text,
          updated_at::text
        FROM service_instances
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [id]
    );
    return toSuccessResponse(
      rows[0] ? sanitizeServiceInstanceRow(rows[0]) : null
    );
  }

  if (action === 'serviceInstances.create') {
    const serviceInstance = readObject(payload?.serviceInstance);
    const providerId = readString(serviceInstance.provider_id);
    const instanceId = readString(serviceInstance.instance_id);
    if (!providerId || !instanceId) {
      return toErrorResponse('Missing required fields', 400);
    }

    const isDefault = readBoolean(serviceInstance.is_default, false);
    if (isDefault) {
      await queryRowsWithPgSystemContext(
        `
          UPDATE service_instances
          SET is_default = FALSE
          WHERE provider_id = $1::uuid
            AND is_default = TRUE
        `,
        [providerId]
      );
    }

    const visibility =
      parseAppVisibility(serviceInstance.visibility) || 'public';
    const rows = await queryRowsWithPgSystemContext<ServiceInstanceRow>(
      `
        INSERT INTO service_instances (
          provider_id,
          instance_id,
          api_path,
          display_name,
          description,
          is_default,
          visibility,
          config,
          created_at,
          updated_at
        )
        VALUES (
          $1::uuid,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8::jsonb,
          NOW(),
          NOW()
        )
        RETURNING
          id::text,
          provider_id::text,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility::text,
          config,
          created_at::text,
          updated_at::text
      `,
      [
        providerId,
        instanceId,
        readString(serviceInstance.api_path) || '',
        readString(serviceInstance.display_name) || null,
        readString(serviceInstance.description) || null,
        isDefault,
        visibility,
        JSON.stringify(readObject(serviceInstance.config)),
      ]
    );

    const created = rows[0] ? sanitizeServiceInstanceRow(rows[0]) : null;
    if (!created) {
      return toErrorResponse('Failed to create service instance', 500);
    }

    await ensureProviderDefaultServiceInstance(providerId, {
      preferredId: created.id,
    });

    const refreshedRows =
      await queryRowsWithPgSystemContext<ServiceInstanceRow>(
        `
        SELECT
          id::text,
          provider_id::text,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility::text,
          config,
          created_at::text,
          updated_at::text
        FROM service_instances
        WHERE id = $1::uuid
        LIMIT 1
      `,
        [created.id]
      );

    return toSuccessResponse(
      refreshedRows[0] ? sanitizeServiceInstanceRow(refreshedRows[0]) : created
    );
  }

  if (action === 'serviceInstances.update') {
    const id = readString(payload?.id);
    const updates = readObject(payload?.updates);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    const currentRows = await queryRowsWithPgSystemContext<{
      id: string;
      provider_id: string;
    }>(
      `
        SELECT id::text, provider_id::text
        FROM service_instances
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [id]
    );
    const current = currentRows[0];
    if (!current) {
      return toErrorResponse('Service instance not found', 404);
    }

    const setClauses: string[] = [];
    const values: unknown[] = [];
    let index = 1;

    for (const [key, rawValue] of Object.entries(updates)) {
      if (!SERVICE_INSTANCE_UPDATE_COLUMNS.has(key)) {
        continue;
      }

      if (key === 'provider_id') {
        const providerId = readString(rawValue);
        if (!providerId) {
          continue;
        }
        setClauses.push(`provider_id = $${index}::uuid`);
        values.push(providerId);
        index += 1;
        continue;
      }

      if (key === 'visibility') {
        const visibility = parseAppVisibility(rawValue);
        if (!visibility) {
          continue;
        }
        setClauses.push(`visibility = $${index}`);
        values.push(visibility);
        index += 1;
        continue;
      }

      if (key === 'config') {
        setClauses.push(`config = $${index}::jsonb`);
        values.push(JSON.stringify(readObject(rawValue)));
        index += 1;
        continue;
      }

      if (key === 'is_default') {
        setClauses.push(`is_default = $${index}`);
        values.push(readBoolean(rawValue, false));
        index += 1;
        continue;
      }

      setClauses.push(`${key} = $${index}`);
      values.push(rawValue ?? null);
      index += 1;
    }

    if (setClauses.length === 0) {
      return toErrorResponse('No fields to update', 400);
    }

    const targetProviderId =
      (Object.prototype.hasOwnProperty.call(updates, 'provider_id')
        ? readString(updates.provider_id)
        : current.provider_id) || current.provider_id;
    const wantsDefault =
      Object.prototype.hasOwnProperty.call(updates, 'is_default') &&
      readBoolean(updates.is_default, false);

    if (wantsDefault) {
      await queryRowsWithPgSystemContext(
        `
          UPDATE service_instances
          SET is_default = FALSE
          WHERE provider_id = $1::uuid
            AND id <> $2::uuid
        `,
        [targetProviderId, id]
      );
    }

    setClauses.push('updated_at = NOW()');
    values.push(id);

    const rows = await queryRowsWithPgSystemContext<ServiceInstanceRow>(
      `
        UPDATE service_instances
        SET ${setClauses.join(', ')}
        WHERE id = $${index}::uuid
        RETURNING
          id::text,
          provider_id::text,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility::text,
          config,
          created_at::text,
          updated_at::text
      `,
      values
    );

    if (!rows[0]) {
      return toErrorResponse('Service instance not found', 404);
    }
    const updated = sanitizeServiceInstanceRow(rows[0]);

    await ensureProviderDefaultServiceInstance(targetProviderId, {
      preferredId: updated.is_default ? updated.id : null,
      excludeId: updated.is_default ? null : updated.id,
    });
    if (current.provider_id !== targetProviderId) {
      await ensureProviderDefaultServiceInstance(current.provider_id, {
        excludeId: updated.id,
      });
    }

    const refreshedRows =
      await queryRowsWithPgSystemContext<ServiceInstanceRow>(
        `
        SELECT
          id::text,
          provider_id::text,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility::text,
          config,
          created_at::text,
          updated_at::text
        FROM service_instances
        WHERE id = $1::uuid
        LIMIT 1
      `,
        [updated.id]
      );

    return toSuccessResponse(
      refreshedRows[0] ? sanitizeServiceInstanceRow(refreshedRows[0]) : updated
    );
  }

  if (action === 'serviceInstances.delete') {
    const id = readString(payload?.id);
    if (!id) {
      return toErrorResponse('Missing id', 400);
    }

    const targetRows = await queryRowsWithPgSystemContext<{
      id: string;
      provider_id: string;
    }>(
      `
        SELECT id::text, provider_id::text
        FROM service_instances
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [id]
    );
    const target = targetRows[0];
    if (!target) {
      return toSuccessResponse(false);
    }

    const deletedRows = await queryRowsWithPgSystemContext<{ id: string }>(
      `
        DELETE FROM service_instances
        WHERE id = $1::uuid
        RETURNING id::text
      `,
      [id]
    );
    const deleted = Boolean(deletedRows[0]?.id);
    if (deleted) {
      await ensureProviderDefaultServiceInstance(target.provider_id);
    }
    return toSuccessResponse(deleted);
  }

  if (action === 'serviceInstances.setDefault') {
    const instanceId = readString(payload?.instanceId);
    if (!instanceId) {
      return toErrorResponse('Missing instanceId', 400);
    }

    const targetRows = await queryRowsWithPgSystemContext<{
      id: string;
      provider_id: string;
    }>(
      `
        SELECT id::text, provider_id::text
        FROM service_instances
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [instanceId]
    );
    const target = targetRows[0];
    if (!target) {
      return toErrorResponse('Specified service instance not found', 404);
    }

    await queryRowsWithPgSystemContext(
      `
        UPDATE service_instances
        SET is_default = FALSE
        WHERE provider_id = $1::uuid
          AND is_default = TRUE
          AND id <> $2::uuid
      `,
      [target.provider_id, instanceId]
    );

    const rows = await queryRowsWithPgSystemContext<ServiceInstanceRow>(
      `
        UPDATE service_instances
        SET is_default = TRUE,
            updated_at = NOW()
        WHERE id = $1::uuid
          AND provider_id = $2::uuid
        RETURNING
          id::text,
          provider_id::text,
          display_name,
          description,
          instance_id,
          api_path,
          is_default,
          visibility::text,
          config,
          created_at::text,
          updated_at::text
      `,
      [instanceId, target.provider_id]
    );

    if (!rows[0]) {
      return toErrorResponse('Failed to set default service instance', 500);
    }

    return toSuccessResponse(sanitizeServiceInstanceRow(rows[0]));
  }

  return null;
}
