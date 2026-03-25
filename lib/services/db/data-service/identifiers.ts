import { DatabaseError } from '@lib/types/result';

import { IDENTIFIER_PATTERN } from './constants';

export function assertIdentifier(identifier: string, label: string): string {
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new DatabaseError(`Invalid ${label}: ${identifier}`, 'sql_guard');
  }
  return identifier;
}

export function quoteIdentifier(identifier: string): string {
  return `"${identifier}"`;
}
