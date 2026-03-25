import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import {
  parsePositiveInt,
  readString,
  toErrorResponse,
  toSuccessResponse,
} from './helpers';
import {
  type ApiActionResponse,
  LOCAL_ERROR_OBSERVABILITY_ACTIONS,
} from './types';

export async function handleErrorObservabilityAction(
  action: string,
  payload: Record<string, unknown> | undefined
): Promise<ApiActionResponse | null> {
  if (!LOCAL_ERROR_OBSERVABILITY_ACTIONS.has(action)) {
    return null;
  }

  if (action === 'errors.getSummary') {
    const hours = Math.min(parsePositiveInt(payload?.hours, 24), 720);
    const rows = await queryRowsWithPgSystemContext<{
      total_unique: string;
      total_occurrences: string;
      critical_count: string;
      error_count: string;
      warn_count: string;
      latest_at: string | null;
    }>(
      `
        SELECT
          COUNT(*)::text AS total_unique,
          COALESCE(SUM(occurrence_count), 0)::text AS total_occurrences,
          COUNT(*) FILTER (WHERE severity = 'critical')::text AS critical_count,
          COUNT(*) FILTER (WHERE severity = 'error')::text AS error_count,
          COUNT(*) FILTER (WHERE severity = 'warn')::text AS warn_count,
          MAX(last_seen_at)::text AS latest_at
        FROM error_events
        WHERE last_seen_at >= NOW() - ($1::text || ' hours')::interval
      `,
      [hours]
    );
    const summary = rows[0];
    return toSuccessResponse({
      totalUnique: Number(summary?.total_unique || 0),
      totalOccurrences: Number(summary?.total_occurrences || 0),
      criticalCount: Number(summary?.critical_count || 0),
      errorCount: Number(summary?.error_count || 0),
      warnCount: Number(summary?.warn_count || 0),
      latestAt: summary?.latest_at || null,
    });
  }

  if (action === 'errors.getRecent') {
    const limit = Math.min(parsePositiveInt(payload?.limit, 50), 200);
    const offset = parsePositiveInt(payload?.offset, 0);
    const rows = await queryRowsWithPgSystemContext<Record<string, unknown>>(
      `
        SELECT
          id,
          fingerprint,
          code,
          source,
          severity,
          retryable,
          user_message,
          developer_message,
          http_status,
          method,
          route,
          request_id,
          trace_id,
          actor_user_id,
          context_json,
          first_seen_at,
          last_seen_at,
          occurrence_count,
          created_at,
          updated_at
        FROM error_events
        ORDER BY last_seen_at DESC
        LIMIT $1
        OFFSET $2
      `,
      [limit, offset]
    );
    return toSuccessResponse(rows);
  }

  return null;
}
