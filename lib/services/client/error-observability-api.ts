import { callInternalDataAction } from '@lib/db/internal-data-api';
import type { Result } from '@lib/types/result';

export interface ErrorEventSummary {
  totalUnique: number;
  totalOccurrences: number;
  criticalCount: number;
  errorCount: number;
  warnCount: number;
  latestAt: string | null;
}

export interface ErrorEventItem {
  id: string;
  fingerprint: string;
  code: string;
  source: string;
  severity: string;
  retryable: boolean;
  user_message: string;
  developer_message: string | null;
  http_status: number | null;
  method: string | null;
  route: string | null;
  request_id: string;
  trace_id: string | null;
  actor_user_id: string | null;
  context_json: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  occurrence_count: number;
  created_at: string;
  updated_at: string;
}

export function getErrorSummary(
  hours: number = 24
): Promise<Result<ErrorEventSummary>> {
  return callInternalDataAction<ErrorEventSummary>('errors.getSummary', {
    hours,
  });
}

export function getRecentErrorEvents(
  limit: number = 50,
  offset: number = 0
): Promise<Result<ErrorEventItem[]>> {
  return callInternalDataAction<ErrorEventItem[]>('errors.getRecent', {
    limit,
    offset,
  });
}
