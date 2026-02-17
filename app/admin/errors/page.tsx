'use client';

import {
  type ErrorEventItem,
  type ErrorEventSummary,
  getErrorSummary,
  getRecentErrorEvents,
} from '@lib/services/client/error-observability-api';
import { cn } from '@lib/utils';
import { AlertTriangle, Bug, Clock3, RefreshCw } from 'lucide-react';

import { useCallback, useEffect, useMemo, useState } from 'react';

function formatDateTime(input: string | null): string {
  if (!input) {
    return '-';
  }

  const date = new Date(input);
  if (Number.isNaN(date.valueOf())) {
    return input;
  }

  return date.toLocaleString();
}

function SeverityPill({ severity }: { severity: string }) {
  const normalized = severity.toLowerCase();
  const className = cn(
    'inline-flex rounded-full px-2 py-0.5 text-xs font-medium',
    normalized === 'critical' && 'bg-red-100 text-red-700',
    normalized === 'error' && 'bg-orange-100 text-orange-700',
    normalized === 'warn' && 'bg-amber-100 text-amber-700',
    normalized === 'info' && 'bg-slate-100 text-slate-700'
  );

  return <span className={className}>{severity}</span>;
}

export default function AdminErrorsPage() {
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ErrorEventSummary | null>(null);
  const [events, setEvents] = useState<ErrorEventItem[]>([]);

  const load = useCallback(async () => {
    setError(null);
    const [summaryResult, eventsResult] = await Promise.all([
      getErrorSummary(24),
      getRecentErrorEvents(50, 0),
    ]);

    if (!summaryResult.success) {
      throw summaryResult.error;
    }
    if (!eventsResult.success) {
      throw eventsResult.error;
    }

    setSummary(summaryResult.data);
    setEvents(eventsResult.data);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const execute = async () => {
      setIsLoading(true);
      try {
        await load();
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load data'
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void execute();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const stats = useMemo(() => {
    if (!summary) {
      return [
        { label: 'Unique Errors (24h)', value: '-' },
        { label: 'Occurrences (24h)', value: '-' },
        { label: 'Critical', value: '-' },
        { label: 'Latest', value: '-' },
      ];
    }

    return [
      { label: 'Unique Errors (24h)', value: String(summary.totalUnique) },
      { label: 'Occurrences (24h)', value: String(summary.totalOccurrences) },
      { label: 'Critical', value: String(summary.criticalCount) },
      { label: 'Latest', value: formatDateTime(summary.latestAt) },
    ];
  }, [summary]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : 'Failed to refresh data'
      );
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-7xl p-6">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
              Error Observability
            </h1>
            <p className="mt-1 text-sm text-stone-600 dark:text-stone-400">
              Unified error events collected from Next/Fastify and proxy paths.
            </p>
          </div>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={refreshing}
            className={cn(
              'inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm',
              'border-stone-300 bg-white text-stone-700 hover:bg-stone-50',
              'disabled:cursor-not-allowed disabled:opacity-60'
            )}
          >
            <RefreshCw
              className={cn('h-4 w-4', refreshing && 'animate-spin')}
            />
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-6 flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {stats.map(stat => (
            <div
              key={stat.label}
              className="rounded-lg border border-stone-200 bg-white p-4 dark:border-stone-700 dark:bg-stone-900"
            >
              <div className="text-xs tracking-wide text-stone-500 uppercase dark:text-stone-400">
                {stat.label}
              </div>
              <div className="mt-2 text-lg font-semibold text-stone-900 dark:text-stone-100">
                {stat.value}
              </div>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-900">
          <div className="border-b border-stone-200 px-4 py-3 text-sm font-medium text-stone-700 dark:border-stone-700 dark:text-stone-200">
            Recent Errors
          </div>
          {isLoading ? (
            <div className="px-4 py-8 text-sm text-stone-500">Loading...</div>
          ) : events.length === 0 ? (
            <div className="flex items-center gap-2 px-4 py-8 text-sm text-stone-500">
              <Clock3 className="h-4 w-4" />
              No error events found.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead className="bg-stone-50 text-xs text-stone-500 uppercase dark:bg-stone-800 dark:text-stone-400">
                  <tr>
                    <th className="px-4 py-3">When</th>
                    <th className="px-4 py-3">Severity</th>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Message</th>
                    <th className="px-4 py-3">Request ID</th>
                    <th className="px-4 py-3">Count</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map(item => (
                    <tr
                      key={item.id}
                      className="border-t border-stone-100 dark:border-stone-800"
                    >
                      <td className="px-4 py-3 text-stone-600 dark:text-stone-300">
                        {formatDateTime(item.last_seen_at)}
                      </td>
                      <td className="px-4 py-3">
                        <SeverityPill severity={item.severity} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-stone-700 dark:text-stone-200">
                        {item.code}
                      </td>
                      <td className="px-4 py-3 text-stone-700 dark:text-stone-200">
                        <div className="flex items-start gap-2">
                          <Bug className="mt-0.5 h-4 w-4 flex-shrink-0 text-stone-400" />
                          <span>{item.user_message}</span>
                        </div>
                        <div className="mt-1 text-xs text-stone-500">
                          {item.method || '-'} {item.route || ''}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-stone-600 dark:text-stone-300">
                        {item.request_id}
                      </td>
                      <td className="px-4 py-3 text-stone-700 dark:text-stone-200">
                        {item.occurrence_count}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
