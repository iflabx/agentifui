'use client';

import { ResizableSplitPane } from '@components/ui/resizable-split-pane';
import { MobileTabSwitcher } from '@components/workflow/mobile-tab-switcher';
import { useMobile } from '@lib/hooks/use-mobile';
import { useWorkflowExecution } from '@lib/hooks/use-workflow-execution';
import { getExecutionById } from '@lib/services/client/app-executions-api';
import { useAppListStore } from '@lib/stores/app-list-store';
import { useWorkflowHistoryStore } from '@lib/stores/workflow-history-store';
import type { AppExecution } from '@lib/types/database';
import { cn } from '@lib/utils';
import { AlertCircle, RefreshCw, X } from 'lucide-react';

import React, { useCallback, useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { ExecutionHistory } from './execution-history';
import { WorkflowInputForm, WorkflowInputFormRef } from './workflow-input-form';
import { WorkflowTracker } from './workflow-tracker';

interface WorkflowLayoutProps {
  instanceId: string;
}

type MobileTab = 'form' | 'tracker' | 'history';

function buildExecutionViewerResult(
  execution: AppExecution
): Record<string, unknown> {
  if (execution.outputs && Object.keys(execution.outputs).length > 0) {
    return execution.outputs;
  }

  return {
    message: 'No detail data available.',
    status: execution.status,
    executionId: execution.id,
    title: execution.title,
    inputs: execution.inputs,
    createdAt: execution.created_at,
    completedAt: execution.completed_at,
    elapsedTime: execution.elapsed_time,
    totalSteps: execution.total_steps,
    totalTokens: execution.total_tokens,
    errorMessage: execution.error_message,
  };
}

/**
 * Workflow main layout component
 *
 * Layout features:
 * - Desktop: left-right split layout (form + tracker)
 * - Mobile: tab switching layout
 * - Foldable history sidebar
 * - Unified status management and data flow
 */
export function WorkflowLayout({ instanceId }: WorkflowLayoutProps) {
  const isMobile = useMobile();
  const t = useTranslations('pages.workflow.buttons');
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const searchParams = useSearchParams();
  const requestedExecutionId = searchParams?.get('executionId');

  // --- New workflow execution system ---
  const {
    isExecuting,
    error,
    canRetry,
    currentExecution,
    executeWorkflow,
    stopWorkflowExecution,
    retryExecution,
    resetExecution,
    clearExecutionState,
  } = useWorkflowExecution(instanceId);

  // --- Keep the original status management ---
  const { showHistory, setShowHistory } = useWorkflowHistoryStore();
  const [mobileActiveTab, setMobileActiveTab] = useState<MobileTab>('form');
  const [restoredExecution, setRestoredExecution] =
    useState<AppExecution | null>(null);
  const [restoredExecutionResult, setRestoredExecutionResult] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [resultOpenSignal, setResultOpenSignal] = useState(0);

  // --- Form reset reference ---
  const formResetRef = React.useRef<WorkflowInputFormRef>(null);
  const handledExecutionIdRef = React.useRef<string | null>(null);

  const clearRequestedExecutionId = useCallback(() => {
    if (!requestedExecutionId) {
      return;
    }

    const nextParams = new URLSearchParams(searchParams?.toString() ?? '');
    nextParams.delete('executionId');
    const nextQuery = nextParams.toString();
    const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;

    router.replace(nextUrl, { scroll: false });
  }, [pathname, requestedExecutionId, router, searchParams]);

  const setRequestedExecutionId = useCallback(
    (executionId: string) => {
      const nextParams = new URLSearchParams(searchParams?.toString() ?? '');
      nextParams.set('executionId', executionId);
      const nextQuery = nextParams.toString();
      const nextUrl = nextQuery ? `${pathname}?${nextQuery}` : pathname;

      router.replace(nextUrl, { scroll: false });
    },
    [pathname, router, searchParams]
  );

  const clearHistoricalExecutionState = useCallback(() => {
    setRestoredExecution(null);
    setRestoredExecutionResult(null);
  }, []);

  const closeHistoricalExecution = useCallback(() => {
    clearHistoricalExecutionState();
    clearRequestedExecutionId();
  }, [clearHistoricalExecutionState, clearRequestedExecutionId]);

  const resolveCurrentApp = useCallback(async () => {
    const appListState = useAppListStore.getState();

    if (appListState.apps.length === 0) {
      await appListState.fetchApps();
    }

    return useAppListStore
      .getState()
      .apps.find(app => app.instance_id === instanceId);
  }, [instanceId]);

  // --- Workflow execution callback, now using the real hook ---
  const handleExecuteWorkflow = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (formData: Record<string, any>) => {
      console.log(
        '[Workflow layout] Start executing workflow, input data:',
        formData
      );

      try {
        handledExecutionIdRef.current = null;
        clearHistoricalExecutionState();
        clearRequestedExecutionId();
        await executeWorkflow(formData);
      } catch (error) {
        console.error('[Workflow layout] Execution failed:', error);
      }
    },
    [clearHistoricalExecutionState, clearRequestedExecutionId, executeWorkflow]
  );

  // --- Stop execution ---
  const handleStopExecution = useCallback(async () => {
    console.log('[Workflow layout] Stop execution');
    try {
      await stopWorkflowExecution();
    } catch (error) {
      console.error('[Workflow layout] Stop execution failed:', error);
    }
  }, [stopWorkflowExecution]);

  // --- Retry execution ---
  const handleRetryExecution = useCallback(async () => {
    console.log('[Workflow layout] Retry execution');
    try {
      await retryExecution();
    } catch (error) {
      console.error('[Workflow layout] Retry execution failed:', error);
    }
  }, [retryExecution]);

  // --- Complete reset (including form) ---
  const handleCompleteReset = useCallback(() => {
    console.log('[Workflow layout] Complete reset');

    // Reset execution state (keep history)
    resetExecution();
    handledExecutionIdRef.current = null;
    closeHistoricalExecution();

    // Reset form
    if (formResetRef.current?.resetForm) {
      formResetRef.current.resetForm();
    }
  }, [closeHistoricalExecution, resetExecution]);

  // --- Clear error ---
  const handleClearError = useCallback(() => {
    console.log('[Workflow layout] Clear error');
    clearExecutionState();
  }, [clearExecutionState]);

  // --- Handle view result ---
  const handleViewResult = useCallback(
    (result: Record<string, unknown>, execution: AppExecution) => {
      console.log('[Workflow layout] View execution result:', execution);
      handledExecutionIdRef.current = execution.id;
      setRestoredExecution(execution);
      setRestoredExecutionResult(result);
      setMobileActiveTab('tracker');
      setResultOpenSignal(signal => signal + 1);
      setRequestedExecutionId(execution.id);
    },
    [setRequestedExecutionId]
  );

  const handleDeletedExecutions = useCallback(
    (deletedExecutionIds: string[]) => {
      const activeExecutionId = requestedExecutionId || restoredExecution?.id;

      if (
        !activeExecutionId ||
        !deletedExecutionIds.includes(activeExecutionId)
      ) {
        return;
      }

      handledExecutionIdRef.current = null;
      closeHistoricalExecution();
      setMobileActiveTab('form');
    },
    [closeHistoricalExecution, requestedExecutionId, restoredExecution?.id]
  );

  const isShowingRestoredExecution = !!restoredExecution && !isExecuting;
  const activeExecution = isShowingRestoredExecution
    ? restoredExecution
    : currentExecution;
  const activeExecutionResult = isShowingRestoredExecution
    ? restoredExecutionResult
    : currentExecution?.outputs || null;

  useEffect(() => {
    if (!requestedExecutionId) {
      handledExecutionIdRef.current = null;
      return;
    }

    if (handledExecutionIdRef.current === requestedExecutionId) {
      return;
    }

    handledExecutionIdRef.current = requestedExecutionId;

    let isCancelled = false;

    const openRequestedExecution = async () => {
      try {
        const currentApp = await resolveCurrentApp();
        if (!currentApp) {
          if (!isCancelled) {
            handledExecutionIdRef.current = null;
            closeHistoricalExecution();
          }
          return;
        }

        const result = await getExecutionById(requestedExecutionId);
        if (!result.success || !result.data) {
          if (!isCancelled) {
            handledExecutionIdRef.current = null;
            closeHistoricalExecution();
          }
          return;
        }

        if (
          result.data.execution_type !== 'workflow' ||
          result.data.service_instance_id !== currentApp.id
        ) {
          if (!isCancelled) {
            handledExecutionIdRef.current = null;
            closeHistoricalExecution();
          }
          return;
        }

        if (isCancelled) {
          return;
        }

        const restoredResult = buildExecutionViewerResult(result.data);
        setRestoredExecution(result.data);
        setRestoredExecutionResult(restoredResult);
        setMobileActiveTab('tracker');
        setResultOpenSignal(signal => signal + 1);
      } catch (error) {
        console.error(
          '[Workflow layout] Failed to open requested execution:',
          error
        );
        if (!isCancelled) {
          handledExecutionIdRef.current = null;
          closeHistoricalExecution();
        }
      }
    };

    void openRequestedExecution();

    return () => {
      isCancelled = true;
    };
  }, [closeHistoricalExecution, requestedExecutionId, resolveCurrentApp]);

  // --- Error banner component ---
  const ErrorBanner = ({
    error,
    canRetry,
    onRetry,
    onDismiss,
  }: {
    error: string;
    canRetry: boolean;
    onRetry: () => void;
    onDismiss: () => void;
  }) => (
    <div
      className={cn(
        'flex items-center gap-3 border-l-4 border-red-500 px-4 py-3',
        'bg-red-50 text-red-800 dark:bg-red-900/20 dark:text-red-200'
      )}
    >
      <AlertCircle className="h-5 w-5 flex-shrink-0 text-red-500" />
      <div className="flex-1">
        <p className="font-serif text-sm">{error}</p>
      </div>
      <div className="flex items-center gap-2">
        {canRetry && (
          <button
            onClick={onRetry}
            className={cn(
              'rounded-md p-1.5 transition-colors',
              'text-red-700 hover:bg-red-200/50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-800/50 dark:hover:text-red-200'
            )}
            title={t('retry')}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        )}
        <button
          onClick={onDismiss}
          className={cn(
            'rounded-md p-1.5 transition-colors',
            'text-red-700 hover:bg-red-200/50 hover:text-red-800 dark:text-red-300 dark:hover:bg-red-800/50 dark:hover:text-red-200'
          )}
          title={t('close')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );

  // --- Mobile layout ---
  if (isMobile) {
    return (
      <div className="flex h-full flex-col overflow-hidden">
        {/* Global error banner */}
        {error && (
          <ErrorBanner
            error={error}
            canRetry={canRetry}
            onRetry={handleRetryExecution}
            onDismiss={handleClearError}
          />
        )}

        {/* Mobile tab switcher */}
        <MobileTabSwitcher
          activeTab={mobileActiveTab}
          onTabChange={setMobileActiveTab}
        />

        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {mobileActiveTab === 'form' && (
            <div className="h-full p-4">
              <WorkflowInputForm
                instanceId={instanceId}
                onExecute={handleExecuteWorkflow}
                isExecuting={isExecuting}
                ref={formResetRef}
              />
            </div>
          )}

          {mobileActiveTab === 'tracker' && (
            <div className="h-full">
              <WorkflowTracker
                isExecuting={isExecuting}
                executionResult={activeExecutionResult}
                currentExecution={activeExecution}
                autoOpenResult={true}
                openResultSignal={resultOpenSignal}
                forceShowResult={
                  isShowingRestoredExecution && !!activeExecutionResult
                }
                onStop={handleStopExecution}
                onRetry={handleRetryExecution}
                onReset={handleCompleteReset}
                onCloseResult={
                  isShowingRestoredExecution
                    ? closeHistoricalExecution
                    : undefined
                }
              />
            </div>
          )}

          {mobileActiveTab === 'history' && (
            <div className="h-full">
              <ExecutionHistory
                instanceId={instanceId}
                onClose={() => setMobileActiveTab('form')}
                isMobile={true}
                onDeleteExecutions={handleDeletedExecutions}
                onViewResult={handleViewResult}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- Desktop layout ---
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Global error banner */}
      {error && (
        <ErrorBanner
          error={error}
          canRetry={canRetry}
          onRetry={handleRetryExecution}
          onDismiss={handleClearError}
        />
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Main content area */}
        <div
          className={cn(
            'relative flex-1 overflow-hidden transition-all duration-300',
            showHistory ? 'lg:w-2/3' : 'w-full'
          )}
        >
          <ResizableSplitPane
            storageKey="workflow-split-pane"
            defaultLeftWidth={50}
            minLeftWidth={25}
            maxLeftWidth={75}
            left={
              <div className="hide-all-scrollbars flex h-full flex-col overflow-hidden">
                <div className="no-scrollbar flex-1 overflow-x-hidden overflow-y-auto px-8 pt-4 pb-12">
                  <WorkflowInputForm
                    instanceId={instanceId}
                    onExecute={handleExecuteWorkflow}
                    isExecuting={isExecuting}
                    ref={formResetRef}
                  />
                </div>
              </div>
            }
            right={
              <div className="hide-all-scrollbars flex h-full flex-col overflow-hidden">
                <div className="no-scrollbar flex-1 overflow-x-hidden overflow-y-auto">
                  <WorkflowTracker
                    isExecuting={isExecuting}
                    executionResult={activeExecutionResult}
                    currentExecution={activeExecution}
                    autoOpenResult={true}
                    openResultSignal={resultOpenSignal}
                    forceShowResult={
                      isShowingRestoredExecution && !!activeExecutionResult
                    }
                    onStop={handleStopExecution}
                    onRetry={handleRetryExecution}
                    onReset={handleCompleteReset}
                    onCloseResult={
                      isShowingRestoredExecution
                        ? closeHistoricalExecution
                        : undefined
                    }
                  />
                </div>
              </div>
            }
          />
        </div>

        {/* History sidebar */}
        {showHistory && (
          <div
            className={cn(
              'w-80 min-w-72 overflow-hidden border-l',
              'transition-all duration-300 ease-in-out',
              'transform-gpu', // Use GPU acceleration
              'border-stone-200 dark:border-stone-700'
            )}
          >
            <ExecutionHistory
              instanceId={instanceId}
              onClose={() => setShowHistory(false)}
              isMobile={false}
              onDeleteExecutions={handleDeletedExecutions}
              onViewResult={handleViewResult}
            />
          </div>
        )}
      </div>
    </div>
  );
}
