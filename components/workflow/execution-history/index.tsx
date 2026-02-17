'use client';

import { useProfile } from '@lib/hooks/use-profile';
import {
  deleteExecution,
  getExecutionById,
  getExecutionsByServiceInstance,
} from '@lib/services/client/app-executions-api';
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';
import type { AppExecution } from '@lib/types/database';
import { cn } from '@lib/utils';
import { History, Loader2, Trash2, X } from 'lucide-react';

import React, { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import { ExecutionItem } from './execution-item';

interface ExecutionHistoryProps {
  instanceId: string;
  onClose: () => void;
  isMobile: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onViewResult: (result: any, execution: AppExecution) => void;
}

/**
 * Execution history record component
 *
 * Features:
 * - Display workflow execution history
 * - Support search
 * - Can view historical execution results
 * - Responsive design
 * - Dynamic open and close effect
 * - Independent scroll container
 */
export function ExecutionHistory({
  instanceId,
  onClose,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  isMobile,
  onViewResult,
}: ExecutionHistoryProps) {
  const { profile } = useProfile();
  const userId = profile?.id;
  const t = useTranslations('pages.workflow.history');
  const [isLoading, setIsLoading] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [searchTerm] = useState(''); // Keep but not used

  // --- Multi-select delete related status ---
  const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);

  // --- View result loading status ---
  const [loadingExecutionId, setLoadingExecutionId] = useState<string | null>(
    null
  );

  const executionHistory = useWorkflowExecutionStore(
    state => state.executionHistory
  );

  // --- Trigger enter animation when the component is mounted ---
  useEffect(() => {
    // Delay the animation to ensure the DOM has been rendered
    const timer = setTimeout(() => setIsVisible(true), 50);
    return () => clearTimeout(timer);
  }, []);

  // --- Handle close ---
  const handleClose = () => {
    // Close immediately, without using animation
    onClose();
  };

  // --- Automatically refresh history records ---
  useEffect(() => {
    const loadHistory = async () => {
      setIsLoading(true);
      try {
        // Get the correct application UUID
        const { useAppListStore } = await import('@lib/stores/app-list-store');
        const currentApps = useAppListStore.getState().apps;
        const targetApp = currentApps.find(
          app => app.instance_id === instanceId
        );

        if (!targetApp) {
          console.warn(
            '[Execution history] Application record not found, instanceId:',
            instanceId
          );
          setIsLoading(false);
          return;
        }

        if (!userId) {
          console.warn(
            '[Execution history] User not logged in, cannot load history'
          );
          setIsLoading(false);
          return;
        }

        const result = await getExecutionsByServiceInstance(
          targetApp.id,
          50
        );

        if (result.success) {
          console.log(
            '[Execution history] History record loaded successfully, number:',
            result.data.length
          );
          useWorkflowExecutionStore.getState().setExecutionHistory(result.data);
        } else {
          console.error(
            '[Execution history] Failed to load history record:',
            result.error
          );
        }
      } catch (error) {
        console.error(
          '[Execution history] Error loading history record:',
          error
        );
      } finally {
        setIsLoading(false);
      }
    };

    loadHistory();
  }, [instanceId]);

  // Directly use all execution records, no filtering
  const displayExecutions = executionHistory;

  // --- Batch delete processing ---
  const handleBatchDelete = async () => {
    if (selectedIds.size === 0) return;

    setIsDeleting(true);
    try {
      console.log('Batch delete execution record:', Array.from(selectedIds));

      // Check user login status
      if (!userId) {
        console.warn(
          '[Execution history] User not logged in, cannot delete execution record'
        );
        return;
      }

      // Delete all selected records in parallel
      const deletePromises = Array.from(selectedIds).map(async id => {
        const result = await deleteExecution(id);
        if (!result.success) {
          console.error(
            `Failed to delete execution record ${id}:`,
            result.error
          );
          return false;
        }
        return true;
      });

      const results = await Promise.all(deletePromises);
      const successCount = results.filter(Boolean).length;
      const failCount = results.length - successCount;

      if (successCount > 0) {
        // Refresh history record list
        await loadHistory();
        console.log(`Successfully deleted ${successCount} records`);
      }

      if (failCount > 0) {
        console.error(`${failCount} records failed to delete`);
      }

      // Clear selected state
      setSelectedIds(new Set());
      setIsMultiSelectMode(false);
    } catch (error) {
      console.error('Batch delete failed:', error);
    } finally {
      setIsDeleting(false);
    }
  };

  // --- Reload history records ---
  const loadHistory = async () => {
    try {
      // Get the correct application UUID
      const { useAppListStore } = await import('@lib/stores/app-list-store');
      const currentApps = useAppListStore.getState().apps;
      const targetApp = currentApps.find(app => app.instance_id === instanceId);

      if (!targetApp) {
        console.warn(
          '[Execution history] Application record not found, instanceId:',
          instanceId
        );
        return;
      }

      if (!userId) {
        console.warn(
          '[Execution history] User not logged in, cannot refresh history'
        );
        return;
      }

      const result = await getExecutionsByServiceInstance(
        targetApp.id,
        50
      );

      if (result.success) {
        console.log(
          '[Execution history] History record refresh successfully, number:',
          result.data.length
        );
        useWorkflowExecutionStore.getState().setExecutionHistory(result.data);
      } else {
        console.error(
          '[Execution history] Failed to refresh history record:',
          result.error
        );
      }
    } catch (error) {
      console.error(
        '[Execution history] Error refreshing history record:',
        error
      );
    }
  };

  // --- Click to view execution details ---
  const handleViewExecution = async (execution: AppExecution) => {
    if (isMultiSelectMode) {
      // Switch selected state in multi-select mode
      const newSelectedIds = new Set(selectedIds);
      if (newSelectedIds.has(execution.id)) {
        newSelectedIds.delete(execution.id);
      } else {
        newSelectedIds.add(execution.id);
      }
      setSelectedIds(newSelectedIds);
    } else {
      // View execution details in normal mode
      try {
        // Set loading state
        setLoadingExecutionId(execution.id);

        // Get complete execution details from database
        console.log('Getting execution details:', execution.id);

        if (!userId) {
          console.warn(
            '[Execution history] User not logged in, cannot get execution details'
          );
          // Display error result
          const errorResult = {
            error: t('getDetailFailed'),
            message: t('userNotLoggedIn'),
            status: 'error',
          };
          onViewResult(errorResult, execution);
          return;
        }

        const result = await getExecutionById(execution.id);

        if (result.success && result.data) {
          const fullExecution = result.data;

          // Use the complete data obtained
          let executionResult = fullExecution.outputs;

          // If there are no outputs, create a result object containing basic information
          if (!executionResult || Object.keys(executionResult).length === 0) {
            executionResult = {
              message: t('noDetailData'),
              status: fullExecution.status,
              executionId: fullExecution.id,
              title: fullExecution.title,
              inputs: fullExecution.inputs,
              createdAt: fullExecution.created_at,
              completedAt: fullExecution.completed_at,
              elapsedTime: fullExecution.elapsed_time,
              totalSteps: fullExecution.total_steps,
              totalTokens: fullExecution.total_tokens,
              errorMessage: fullExecution.error_message,
            };
          }

          // Call the callback function of the parent component
          onViewResult(executionResult, fullExecution);
        } else {
          // Display error result
          const errorResult = {
            error: t('getDetailFailed'),
            message: result.error?.message || t('unknownError'),
            status: 'error',
          };
          onViewResult(errorResult, execution);
        }
      } catch (error) {
        console.error('Failed to get execution details:', error);
        // Display error result
        const errorResult = {
          error: t('getDetailFailed'),
          message: error instanceof Error ? error.message : t('unknownError'),
          status: 'error',
        };
        onViewResult(errorResult, execution);
      } finally {
        // Clear loading state
        setLoadingExecutionId(null);
      }
    }
  };

  return (
    <div
      className={cn(
        'relative flex h-full flex-col overflow-hidden',
        // --- Use the same background color as the page ---
        'bg-stone-50 dark:bg-stone-950',
        // --- Animation effect ---
        'transition-all duration-300 ease-in-out',
        isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0',
        isClosing && 'translate-x-full opacity-0'
      )}
    >
      {/* --- Main content: use absolute positioning to fill the container --- */}
      <div className="absolute inset-0 z-10 flex flex-col">
        {/* Header */}
        <div
          className={cn(
            'flex-shrink-0 border-b p-3',
            'border-stone-300/50 dark:border-stone-700/50',
            // --- Header animation: slide in from above ---
            'transition-all delay-100 duration-300 ease-out',
            isVisible ? 'translate-y-0 opacity-100' : '-translate-y-4 opacity-0'
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <History
                className={cn(
                  'h-4 w-4 transition-transform duration-300',
                  'text-stone-600 dark:text-stone-400',
                  isVisible ? 'rotate-0' : 'rotate-180'
                )}
              />
              <h2
                className={cn(
                  'font-serif text-base font-semibold',
                  'text-stone-900 dark:text-gray-100'
                )}
              >
                {t('title')}
              </h2>
              {/* Selected count */}
              {isMultiSelectMode && selectedIds.size > 0 && (
                <span
                  className={cn(
                    'rounded-md px-2 py-1 font-serif text-sm',
                    'bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-300'
                  )}
                >
                  {t('selected', { count: selectedIds.size })}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Multi-select mode button */}
              {!isMultiSelectMode ? (
                <button
                  onClick={() => setIsMultiSelectMode(true)}
                  className={cn(
                    'rounded-md p-1.5 transition-all duration-200',
                    'hover:scale-110 active:scale-95',
                    'text-stone-600 hover:bg-stone-200/50 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-700/50 dark:hover:text-stone-300'
                  )}
                  title={t('batchDelete')}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              ) : (
                <>
                  {/* Batch delete execution button */}
                  <button
                    onClick={handleBatchDelete}
                    disabled={selectedIds.size === 0 || isDeleting}
                    className={cn(
                      'rounded-md p-1.5 transition-all duration-200',
                      'hover:scale-110 active:scale-95',
                      selectedIds.size === 0 || isDeleting
                        ? 'cursor-not-allowed opacity-50'
                        : 'text-red-600 hover:bg-red-100/50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-700/50 dark:hover:text-red-300'
                    )}
                    title={t('deleteSelected', { count: selectedIds.size })}
                  >
                    {isDeleting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>

                  {/* Cancel multi-select mode */}
                  <button
                    onClick={() => {
                      setIsMultiSelectMode(false);
                      setSelectedIds(new Set());
                    }}
                    className={cn(
                      'rounded-md p-1.5 transition-all duration-200',
                      'hover:scale-110 active:scale-95',
                      'text-stone-600 hover:bg-stone-200/50 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-700/50 dark:hover:text-stone-300'
                    )}
                    title={t('cancelSelection')}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              )}

              {/* Close button */}
              {!isMultiSelectMode && (
                <button
                  onClick={handleClose}
                  className={cn(
                    'rounded-md p-1.5 transition-all duration-200',
                    'hover:scale-110 active:scale-95',
                    'text-stone-600 hover:bg-stone-200/50 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-700/50 dark:hover:text-stone-300'
                  )}
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>

        {/* --- Execution record list (independent scroll container) --- */}
        <div
          className={cn(
            'flex-1 overflow-x-hidden overflow-y-auto',
            // --- Custom scrollbar style ---
            'scrollbar-thin',
            'scrollbar-track-stone-100 scrollbar-thumb-stone-300 hover:scrollbar-thumb-stone-400 dark:scrollbar-track-stone-800 dark:scrollbar-thumb-stone-600 dark:hover:scrollbar-thumb-stone-500',
            // --- List animation: slide in from below ---
            'transition-all delay-200 duration-300 ease-out',
            isVisible ? 'translate-y-0 opacity-100' : 'translate-y-4 opacity-0'
          )}
        >
          {isLoading ? (
            <div className="p-4 text-center">
              <div className="flex items-center justify-center gap-2">
                <Loader2
                  className={cn(
                    'h-4 w-4 animate-spin transition-all duration-300',
                    'text-stone-500',
                    isVisible ? 'scale-100' : 'scale-75'
                  )}
                />
                <div
                  className={cn(
                    'font-serif text-sm transition-all duration-300',
                    'text-stone-500',
                    isVisible ? 'opacity-100' : 'opacity-0'
                  )}
                >
                  {t('loading')}
                </div>
              </div>
            </div>
          ) : displayExecutions.length === 0 ? (
            <div className="p-4 text-center">
              <div
                className={cn(
                  'font-serif text-sm transition-all duration-300',
                  'text-stone-500',
                  isVisible
                    ? 'translate-y-0 opacity-100'
                    : 'translate-y-2 opacity-0'
                )}
              >
                {t('noRecords')}
              </div>
            </div>
          ) : (
            <div className="space-y-2 p-2">
              {displayExecutions.map((execution: AppExecution, index) => (
                <div
                  key={execution.id}
                  className={cn(
                    'transition-all duration-300 ease-out',
                    isVisible
                      ? 'translate-x-0 opacity-100'
                      : 'translate-x-4 opacity-0'
                  )}
                  style={{
                    transitionDelay: `${300 + index * 50}ms`, // Each item appears with a delay of 50ms
                  }}
                >
                  <ExecutionItem
                    execution={execution}
                    onClick={() => handleViewExecution(execution)}
                    isMultiSelectMode={isMultiSelectMode}
                    isSelected={selectedIds.has(execution.id)}
                    isLoading={loadingExecutionId === execution.id}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
