import { assertIdentifier, quoteIdentifier } from './identifiers';
import type { OrderByOption, PaginationOption, WhereClause } from './types';

export function buildWhereClause(
  filters: Record<string, unknown>,
  startIndex: number
): WhereClause {
  const whereClauses: string[] = [];
  const params: unknown[] = [];
  let index = startIndex;

  Object.entries(filters).forEach(([key, rawValue]) => {
    if (rawValue === undefined) {
      return;
    }

    const safeColumn = assertIdentifier(key, 'column');
    if (rawValue === null) {
      whereClauses.push(`${quoteIdentifier(safeColumn)} IS NULL`);
      return;
    }

    whereClauses.push(`${quoteIdentifier(safeColumn)} = $${index}`);
    params.push(toSqlValue(rawValue));
    index += 1;
  });

  if (whereClauses.length === 0) {
    return { clause: '', params: [] };
  }

  return {
    clause: `WHERE ${whereClauses.join(' AND ')}`,
    params,
  };
}

export function buildOrderByClause(orderBy?: OrderByOption): string {
  if (!orderBy) {
    return '';
  }

  const safeColumn = assertIdentifier(orderBy.column, 'column');
  return `ORDER BY ${quoteIdentifier(safeColumn)} ${orderBy.ascending ? 'ASC' : 'DESC'}`;
}

export function buildPaginationClause(pagination?: PaginationOption): string {
  if (!pagination) {
    return '';
  }

  const offset = Math.max(0, Number(pagination.offset || 0));
  const limit = Math.max(0, Number(pagination.limit || 0));
  return `LIMIT ${limit} OFFSET ${offset}`;
}

export function toSqlValue(value: unknown): unknown {
  if (value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value;
  }

  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }

  return value;
}
