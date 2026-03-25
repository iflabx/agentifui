import { getManagedCrudRepository } from '@lib/server/db/repositories';
import { DatabaseError } from '@lib/types/result';

import { TABLE_ACCESS_OWNERS } from './constants';
import type { SqlPool, TableAccessOwner } from './types';

export function resolveTableAccessOwner(table: string): TableAccessOwner {
  const owner = (
    TABLE_ACCESS_OWNERS as Record<string, TableAccessOwner | undefined>
  )[table];
  if (!owner) {
    throw new DatabaseError(
      `Table owner is not declared for table: ${table}`,
      'sql_guard'
    );
  }
  return owner;
}

export function resolveManagedRepositoryForOwnedTable(
  table: string,
  pool: SqlPool
) {
  const owner = resolveTableAccessOwner(table);
  if (owner !== 'managed') {
    return null;
  }

  const repository = getManagedCrudRepository(table, pool);
  if (!repository) {
    throw new DatabaseError(
      `Managed repository is missing for table: ${table}`,
      'drizzle'
    );
  }
  return repository;
}
