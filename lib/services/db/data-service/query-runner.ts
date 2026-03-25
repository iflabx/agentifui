import {
  DatabaseError,
  type Result,
  failure,
  success,
  wrapAsync,
} from '@lib/types/result';

import { cacheService } from '../cache-service';
import type { QueryOptions } from './types';

export function isNonRetryableDatabaseError(error: Error): boolean {
  const message = error.message.toLowerCase();
  return (
    message.includes('unique constraint') ||
    message.includes('foreign key') ||
    message.includes('check constraint') ||
    message.includes('not null') ||
    message.includes('permission denied') ||
    message.includes('row level security')
  );
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export class DataServiceQueryRunner {
  async query<T>(
    operation: () => Promise<T>,
    cacheKey?: string,
    options: QueryOptions = {}
  ): Promise<Result<T>> {
    const {
      cache = false,
      cacheTTL = 5 * 60 * 1000,
      retries = 3,
      retryDelay = 1000,
    } = options;

    if (cache && cacheKey) {
      try {
        return success(await cacheService.get(cacheKey, operation, cacheTTL));
      } catch (error) {
        return failure(
          error instanceof Error ? error : new Error(String(error))
        );
      }
    }

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      const result = await wrapAsync(operation);

      if (result.success) {
        return result;
      }

      if (attempt === retries || isNonRetryableDatabaseError(result.error)) {
        return result;
      }

      await delay(retryDelay * attempt);
      console.log(
        `[DataService] Retry attempt ${attempt}, error:`,
        result.error.message
      );
    }

    return failure(
      new DatabaseError('Query failed, max retries reached', 'query')
    );
  }

  async executeQuery<T>(
    queryBuilder: (() => Promise<T>) | Promise<T>,
    operation: string,
    cacheKey?: string,
    options: QueryOptions = {}
  ): Promise<Result<T>> {
    const operationRunner =
      typeof queryBuilder === 'function'
        ? (queryBuilder as () => Promise<T>)
        : async () => queryBuilder;

    return this.query(
      async () => {
        try {
          return await operationRunner();
        } catch (error) {
          throw new DatabaseError(
            `${operation} failed: ${error instanceof Error ? error.message : String(error)}`,
            operation,
            error instanceof Error ? error : undefined
          );
        }
      },
      cacheKey,
      options
    );
  }
}
