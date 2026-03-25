import type { ServiceInstance } from '../../types/database';
import {
  SERVICE_INSTANCE_UPDATE_COLUMNS,
  SQL_IDENTIFIER,
  type ServiceInstanceUpdateInput,
} from './types';

export function normalizeServiceInstanceRow(
  row: Record<string, unknown>
): ServiceInstance {
  const createdAt = row.created_at;
  const updatedAt = row.updated_at;

  return {
    id: String(row.id),
    provider_id: String(row.provider_id),
    display_name:
      row.display_name === null || row.display_name === undefined
        ? null
        : String(row.display_name),
    description:
      row.description === null || row.description === undefined
        ? null
        : String(row.description),
    instance_id: String(row.instance_id),
    api_path: String(row.api_path ?? ''),
    is_default: Boolean(row.is_default),
    visibility: String(row.visibility) as ServiceInstance['visibility'],
    config: (row.config as ServiceInstance['config']) || {},
    created_at:
      createdAt instanceof Date ? createdAt.toISOString() : String(createdAt),
    updated_at:
      updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt),
  };
}

export function getValidServiceInstanceUpdateKeys(
  updates: ServiceInstanceUpdateInput
) {
  const updateKeys = Object.keys(updates).filter(
    key => (updates as Record<string, unknown>)[key] !== undefined
  );
  const validKeys = updateKeys.filter(
    key => SQL_IDENTIFIER.test(key) && SERVICE_INSTANCE_UPDATE_COLUMNS.has(key)
  );

  return {
    updateKeys,
    validKeys,
  };
}

export function buildServiceInstanceSetClause(
  updates: ServiceInstanceUpdateInput,
  keys: string[]
) {
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let index = 1;

  for (const key of keys) {
    const isJsonColumn = key === 'config';
    setClauses.push(`${key} = $${index}${isJsonColumn ? '::jsonb' : ''}`);
    const rawValue = (updates as Record<string, unknown>)[key];
    if (key === 'config') {
      values.push(JSON.stringify(rawValue || {}));
    } else {
      values.push(rawValue);
    }
    index += 1;
  }

  return {
    nextParamIndex: index,
    setClauses,
    values,
  };
}
