'use client';

import { useEffect, useMemo, useState } from 'react';

type RealtimeStats = {
  total: number;
  byTable: Record<string, number>;
  byEvent: Record<string, number>;
  oldestSubscription?: {
    key: string;
    age: number;
  };
};

type RealtimeSubscription = {
  key: string;
  table: string;
  event: string;
  filter?: string;
  handlerCount: number;
  age: number;
};

type RealtimeBroker = {
  channel: string;
  streamKey: string;
  streamLength: number;
  localListenerCount: number;
  subscriberReady: boolean;
  pubSubSubscriberCount: number;
  publishFailureTotal: number;
  publishFailureLastAt: string | null;
  publishFailureLastError: string | null;
  outboxPendingCount: number;
};

type RealtimeStatsResponse = {
  success: boolean;
  error?: string;
  stats?: RealtimeStats;
  subscriptions?: RealtimeSubscription[];
  broker?: RealtimeBroker;
};

function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) {
    return '-';
  }

  if (ms < 1000) {
    return `${Math.round(ms)}ms`;
  }

  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export default function AdminRealtimePage() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<RealtimeStatsResponse | null>(null);

  const fetchStats = async (silent: boolean = false) => {
    if (!silent) {
      setRefreshing(true);
    }

    try {
      const response = await fetch('/api/internal/realtime/stats', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      const data = (await response
        .json()
        .catch(() => null)) as RealtimeStatsResponse | null;

      if (!response.ok || !data?.success) {
        const message = data?.error || `HTTP ${response.status}`;
        throw new Error(message);
      }

      setPayload(data);
      setError(null);
    } catch (fetchError) {
      const message =
        fetchError instanceof Error ? fetchError.message : String(fetchError);
      setError(message);
    } finally {
      setLoading(false);
      if (!silent) {
        setRefreshing(false);
      }
    }
  };

  useEffect(() => {
    fetchStats().catch(() => {
      // Error is handled in fetchStats.
    });

    const timer = window.setInterval(() => {
      fetchStats(true).catch(() => {
        // Error is handled in fetchStats.
      });
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, []);

  const stats = payload?.stats;
  const broker = payload?.broker;
  const subscriptions = payload?.subscriptions || [];

  const byTable = useMemo(
    () => Object.entries(stats?.byTable || {}).sort((a, b) => b[1] - a[1]),
    [stats?.byTable]
  );
  const byEvent = useMemo(
    () => Object.entries(stats?.byEvent || {}).sort((a, b) => b[1] - a[1]),
    [stats?.byEvent]
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 dark:text-stone-100">
            Realtime Dashboard
          </h1>
          <p className="text-sm text-stone-600 dark:text-stone-400">
            SSE/Redis 实时通道状态、订阅分布与回放窗口指标
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            fetchStats().catch(() => {
              // Error is handled in fetchStats.
            });
          }}
          className="rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:text-stone-200 dark:hover:bg-stone-800"
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {error ? (
        <div className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
        </div>
      ) : null}

      {loading ? (
        <div className="rounded-md border border-stone-300 bg-white px-4 py-3 text-sm text-stone-700 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
          Loading realtime stats...
        </div>
      ) : null}

      {!loading && stats && broker ? (
        <>
          <div className="grid gap-4 md:grid-cols-6">
            <div className="rounded-md border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
              <div className="text-xs text-stone-500 dark:text-stone-400">
                Active Subscriptions
              </div>
              <div className="mt-2 text-2xl font-semibold text-stone-900 dark:text-stone-100">
                {stats.total}
              </div>
            </div>
            <div className="rounded-md border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
              <div className="text-xs text-stone-500 dark:text-stone-400">
                Redis Stream Length
              </div>
              <div className="mt-2 text-2xl font-semibold text-stone-900 dark:text-stone-100">
                {broker.streamLength}
              </div>
            </div>
            <div className="rounded-md border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
              <div className="text-xs text-stone-500 dark:text-stone-400">
                Local Listeners
              </div>
              <div className="mt-2 text-2xl font-semibold text-stone-900 dark:text-stone-100">
                {broker.localListenerCount}
              </div>
            </div>
            <div className="rounded-md border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
              <div className="text-xs text-stone-500 dark:text-stone-400">
                Subscriber Ready
              </div>
              <div className="mt-2 text-2xl font-semibold text-stone-900 dark:text-stone-100">
                {broker.subscriberReady ? 'YES' : 'NO'}
              </div>
            </div>
            <div className="rounded-md border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
              <div className="text-xs text-stone-500 dark:text-stone-400">
                Cluster Subscribers
              </div>
              <div className="mt-2 text-2xl font-semibold text-stone-900 dark:text-stone-100">
                {broker.pubSubSubscriberCount}
              </div>
            </div>
            <div className="rounded-md border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
              <div className="text-xs text-stone-500 dark:text-stone-400">
                Outbox Pending
              </div>
              <div className="mt-2 text-2xl font-semibold text-stone-900 dark:text-stone-100">
                {broker.outboxPendingCount}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
            <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              Publish Health
            </h2>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <div className="text-xs text-stone-500 dark:text-stone-400">
                  Total Publish Failures
                </div>
                <div className="text-lg font-semibold text-stone-900 dark:text-stone-100">
                  {broker.publishFailureTotal}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-500 dark:text-stone-400">
                  Last Failure At
                </div>
                <div className="text-sm text-stone-800 dark:text-stone-200">
                  {broker.publishFailureLastAt || '-'}
                </div>
              </div>
              <div>
                <div className="text-xs text-stone-500 dark:text-stone-400">
                  Last Failure Error
                </div>
                <div className="text-sm text-stone-800 dark:text-stone-200">
                  {broker.publishFailureLastError || '-'}
                </div>
              </div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
              <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                By Table
              </h2>
              <div className="mt-3 space-y-2">
                {byTable.length === 0 ? (
                  <div className="text-sm text-stone-500 dark:text-stone-400">
                    No active table subscriptions
                  </div>
                ) : (
                  byTable.map(([table, count]) => (
                    <div
                      key={table}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="font-mono text-stone-700 dark:text-stone-300">
                        {table}
                      </span>
                      <span className="text-stone-500 dark:text-stone-400">
                        {count}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="rounded-md border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
              <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
                By Event
              </h2>
              <div className="mt-3 space-y-2">
                {byEvent.length === 0 ? (
                  <div className="text-sm text-stone-500 dark:text-stone-400">
                    No active event subscriptions
                  </div>
                ) : (
                  byEvent.map(([event, count]) => (
                    <div
                      key={event}
                      className="flex items-center justify-between text-sm"
                    >
                      <span className="font-mono text-stone-700 dark:text-stone-300">
                        {event}
                      </span>
                      <span className="text-stone-500 dark:text-stone-400">
                        {count}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          <div className="rounded-md border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
            <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              Runtime Broker
            </h2>
            <div className="mt-3 grid gap-2 text-sm text-stone-700 dark:text-stone-300">
              <div>
                Channel: <span className="font-mono">{broker.channel}</span>
              </div>
              <div>
                Stream Key:{' '}
                <span className="font-mono">{broker.streamKey}</span>
              </div>
              <div>
                Oldest Subscription:{' '}
                <span className="font-mono">
                  {stats.oldestSubscription?.key || '-'}
                </span>
              </div>
              <div>
                Oldest Age:{' '}
                <span className="font-mono">
                  {formatAge(stats.oldestSubscription?.age || 0)}
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-md border border-stone-300 bg-white p-4 dark:border-stone-700 dark:bg-stone-900">
            <h2 className="text-sm font-semibold text-stone-900 dark:text-stone-100">
              Subscriptions
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-stone-200 dark:border-stone-800">
                    <th className="px-2 py-2 font-medium text-stone-500 dark:text-stone-400">
                      Key
                    </th>
                    <th className="px-2 py-2 font-medium text-stone-500 dark:text-stone-400">
                      Table
                    </th>
                    <th className="px-2 py-2 font-medium text-stone-500 dark:text-stone-400">
                      Event
                    </th>
                    <th className="px-2 py-2 font-medium text-stone-500 dark:text-stone-400">
                      Filter
                    </th>
                    <th className="px-2 py-2 font-medium text-stone-500 dark:text-stone-400">
                      Handlers
                    </th>
                    <th className="px-2 py-2 font-medium text-stone-500 dark:text-stone-400">
                      Age
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-2 py-4 text-stone-500 dark:text-stone-400"
                      >
                        No active subscriptions
                      </td>
                    </tr>
                  ) : (
                    subscriptions.map(item => (
                      <tr
                        key={item.key}
                        className="border-b border-stone-100 dark:border-stone-800/80"
                      >
                        <td className="px-2 py-2 font-mono text-xs text-stone-700 dark:text-stone-300">
                          {item.key}
                        </td>
                        <td className="px-2 py-2 font-mono text-xs text-stone-700 dark:text-stone-300">
                          {item.table}
                        </td>
                        <td className="px-2 py-2 font-mono text-xs text-stone-700 dark:text-stone-300">
                          {item.event}
                        </td>
                        <td className="px-2 py-2 font-mono text-xs text-stone-700 dark:text-stone-300">
                          {item.filter || '-'}
                        </td>
                        <td className="px-2 py-2 text-stone-600 dark:text-stone-300">
                          {item.handlerCount}
                        </td>
                        <td className="px-2 py-2 text-stone-600 dark:text-stone-300">
                          {formatAge(item.age)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
