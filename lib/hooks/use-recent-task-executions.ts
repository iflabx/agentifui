'use client';

import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import { getUserExecutions } from '@lib/services/client/app-executions-api';
import { useAppListStore } from '@lib/stores/app-list-store';
import type {
  AppExecution,
  ExecutionStatus,
  ExecutionType,
} from '@lib/types/database';

import { useCallback, useEffect, useState } from 'react';

type RecentTaskAppType = Extract<ExecutionType, 'workflow' | 'text-generation'>;

export interface RecentTaskExecution {
  kind: 'execution';
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  status: ExecutionStatus;
  appInstanceId: string;
  appType: RecentTaskAppType;
}

const TERMINAL_EXECUTION_STATUSES = new Set<ExecutionStatus>([
  'completed',
  'failed',
  'stopped',
]);

function isRecentTaskAppType(value: unknown): value is RecentTaskAppType {
  return value === 'workflow' || value === 'text-generation';
}

function normalizeExecutionTitle(execution: AppExecution): string {
  const promptPreview = extractFirstMeaningfulString(execution.inputs);
  if (promptPreview) {
    return promptPreview;
  }

  const rawTitle = execution.title.trim();
  if (rawTitle) {
    return rawTitle;
  }

  return execution.execution_type === 'workflow'
    ? 'Workflow Execution'
    : 'Text Generation';
}

function extractFirstMeaningfulString(
  value: unknown,
  depth: number = 0
): string | null {
  if (depth > 3 || value == null) {
    return null;
  }

  if (typeof value === 'string') {
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) {
      return null;
    }

    return normalized.length > 48
      ? `${normalized.slice(0, 48).trimEnd()}...`
      : normalized;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const match = extractFirstMeaningfulString(item, depth + 1);
      if (match) {
        return match;
      }
    }
    return null;
  }

  if (typeof value === 'object') {
    for (const nestedValue of Object.values(value as Record<string, unknown>)) {
      const match = extractFirstMeaningfulString(nestedValue, depth + 1);
      if (match) {
        return match;
      }
    }
  }

  return null;
}

export function useRecentTaskExecutions(limit: number = 20) {
  const { session } = useAuthSession();
  const userId = session?.user?.id ?? null;
  const [executions, setExecutions] = useState<RecentTaskExecution[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const loadExecutions = useCallback(async () => {
    if (!userId) {
      setExecutions([]);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const appListState = useAppListStore.getState();
      if (appListState.apps.length === 0) {
        await appListState.fetchApps();
      }

      const apps = useAppListStore.getState().apps;
      const result = await getUserExecutions(limit);

      if (!result.success) {
        throw result.error;
      }

      const mappedExecutions = result.data
        .filter(execution => TERMINAL_EXECUTION_STATUSES.has(execution.status))
        .map(execution => {
          const app = apps.find(
            item => item.id === execution.service_instance_id
          );
          const appType = app?.config?.app_metadata?.dify_apptype;

          if (!app || !isRecentTaskAppType(appType)) {
            return null;
          }

          return {
            kind: 'execution' as const,
            id: execution.id,
            title: normalizeExecutionTitle(execution),
            created_at: execution.created_at,
            updated_at: execution.updated_at,
            status: execution.status,
            appInstanceId: app.instance_id,
            appType,
          };
        })
        .filter(
          (execution): execution is RecentTaskExecution => execution !== null
        )
        .sort((left, right) => {
          const leftTime = new Date(left.updated_at).getTime();
          const rightTime = new Date(right.updated_at).getTime();
          return rightTime - leftTime;
        });

      setExecutions(mappedExecutions);
    } catch (loadError) {
      console.error(
        '[useRecentTaskExecutions] Failed to load executions:',
        loadError
      );
      setExecutions([]);
      setError(
        loadError instanceof Error ? loadError : new Error(String(loadError))
      );
    } finally {
      setIsLoading(false);
    }
  }, [limit, userId]);

  useEffect(() => {
    void loadExecutions();
  }, [loadExecutions]);

  useEffect(() => {
    const unsubscribe = conversationEvents.subscribe(() => {
      void loadExecutions();
    });

    return () => {
      unsubscribe();
    };
  }, [loadExecutions]);

  return {
    executions,
    isLoading,
    error,
    refresh: loadExecutions,
  };
}
