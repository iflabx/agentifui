'use client';

import { ResizableSplitPane } from '@components/ui/resizable-split-pane';
import { ExecutionHistory } from '@components/workflow/execution-history';
import { MobileTabSwitcher } from '@components/workflow/mobile-tab-switcher';
import {
  WorkflowInputForm,
  WorkflowInputFormRef,
} from '@components/workflow/workflow-input-form';
import { useMobile } from '@lib/hooks/use-mobile';
import { useTextGenerationExecution } from '@lib/hooks/use-text-generation-execution';
import { useWorkflowHistoryStore } from '@lib/stores/workflow-history-store';
import type { AppExecution } from '@lib/types/database';
import { cn } from '@lib/utils';
import { AlertCircle, RefreshCw, X } from 'lucide-react';

import React, { useCallback, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { TextGenerationResultViewer } from './text-generation-result-viewer';
import { TextGenerationTracker } from './text-generation-tracker';

interface TextGenerationLayoutProps {
  instanceId: string;
}

/**
 * Text generation main layout component
 *
 * Layout characteristics:
 * - Desktop: left and right split layout (form + tracker)
 * - Mobile: tab switching layout
 * - Collapsible history sidebar
 * - Reuse workflow state management and data flow
 * - Adapt to the streaming output characteristics of text generation
 */
export function TextGenerationLayout({
  instanceId,
}: TextGenerationLayoutProps) {
  const isMobile = useMobile();
  const t = useTranslations('pages.textGeneration.buttons');

  // --- Text generation execution system ---
  const {
    isExecuting,
    isStreaming,
    error,
    canRetry,
    currentExecution,
    generatedText,
    executeTextGeneration,
    stopTextGeneration,
    retryTextGeneration,
    clearError,
    resetTextGeneration,
  } = useTextGenerationExecution(instanceId);

  // --- Preserve the original state management ---
  const { showHistory, setShowHistory } = useWorkflowHistoryStore();
  const [mobileActiveTab, setMobileActiveTab] = useState<
    'form' | 'tracker' | 'history'
  >('form');

  // --- Result viewer state ---
  const [showResultViewer, setShowResultViewer] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic result data structure
  const [viewerResult, setViewerResult] = useState<Record<string, any> | null>(
    null
  );
  const [viewerExecution, setViewerExecution] = useState<AppExecution | null>(
    null
  );

  // --- Form reset reference ---
  const formResetRef = useRef<WorkflowInputFormRef>(null);

  // --- Text generation execution callback ---
  const handleExecuteTextGeneration = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic form data structure
    async (formData: Record<string, any>) => {
      try {
        await executeTextGeneration(formData);
      } catch (error: unknown) {
        console.error('[Text generation layout] Execution failed:', error);
      }
    },
    [executeTextGeneration]
  );

  // --- Stop execution ---
  const handleStopExecution = useCallback(async () => {
    console.log('[Text generation layout] Stop execution');
    try {
      await stopTextGeneration();
    } catch (error) {
      console.error('[Text generation layout] Stop execution failed:', error);
    }
  }, [stopTextGeneration]);

  // --- Retry execution ---
  const handleRetryExecution = useCallback(async () => {
    console.log('[Text generation layout] Retry execution');
    try {
      await retryTextGeneration();
    } catch (error) {
      console.error('[Text generation layout] Retry execution failed:', error);
    }
  }, [retryTextGeneration]);

  // --- Complete reset (including form) ---
  const handleCompleteReset = useCallback(() => {
    console.log('[Text generation layout] Complete reset');

    // Reset execution state
    resetTextGeneration();

    // Reset form
    if (formResetRef.current?.resetForm) {
      formResetRef.current.resetForm();
    }
  }, [resetTextGeneration]);

  // --- Clear error ---
  const handleClearError = useCallback(() => {
    clearError();
  }, [clearError]);

  // --- View result callback ---
  const handleViewResult = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic result data structure
    (result: Record<string, any>, execution: AppExecution) => {
      setViewerResult(result);
      setViewerExecution(execution);
      setShowResultViewer(true);
    },
    []
  );

  // --- Close result viewer ---
  const handleCloseResultViewer = useCallback(() => {
    setShowResultViewer(false);
    setViewerResult(null);
    setViewerExecution(null);
  }, []);

  // --- Error prompt component ---
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
        {/* Global error prompt */}
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
                onExecute={handleExecuteTextGeneration}
                isExecuting={isExecuting}
                ref={formResetRef}
              />
            </div>
          )}

          {mobileActiveTab === 'tracker' && (
            <div className="h-full">
              <TextGenerationTracker
                isExecuting={isExecuting}
                isStreaming={isStreaming}
                generatedText={generatedText}
                currentExecution={currentExecution}
                onStop={handleStopExecution}
                onRetry={handleRetryExecution}
                onReset={handleCompleteReset}
              />
            </div>
          )}

          {mobileActiveTab === 'history' && (
            <div className="h-full">
              <ExecutionHistory
                instanceId={instanceId}
                onClose={() => setMobileActiveTab('form')}
                isMobile={true}
                onViewResult={handleViewResult}
              />
            </div>
          )}
        </div>

        {/* Result viewer popup */}
        {showResultViewer && viewerResult && viewerExecution && (
          <TextGenerationResultViewer
            result={viewerResult}
            execution={viewerExecution}
            onClose={handleCloseResultViewer}
          />
        )}
      </div>
    );
  }

  // --- Desktop layout ---
  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* Global error prompt */}
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
            storageKey="text-generation-split-pane"
            defaultLeftWidth={50}
            minLeftWidth={25}
            maxLeftWidth={75}
            left={
              <div className="hide-all-scrollbars flex h-full flex-col overflow-hidden">
                <div className="no-scrollbar flex-1 overflow-x-hidden overflow-y-auto px-8 pt-4 pb-12">
                  <WorkflowInputForm
                    instanceId={instanceId}
                    onExecute={handleExecuteTextGeneration}
                    isExecuting={isExecuting}
                    ref={formResetRef}
                  />
                </div>
              </div>
            }
            right={
              <div className="hide-all-scrollbars flex h-full flex-col overflow-hidden">
                <div className="no-scrollbar flex-1 overflow-x-hidden overflow-y-auto">
                  <TextGenerationTracker
                    isExecuting={isExecuting}
                    isStreaming={isStreaming}
                    generatedText={generatedText}
                    currentExecution={currentExecution}
                    onStop={handleStopExecution}
                    onRetry={handleRetryExecution}
                    onReset={handleCompleteReset}
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
              onViewResult={handleViewResult}
            />
          </div>
        )}
      </div>

      {/* Result viewer popup */}
      {showResultViewer && viewerResult && viewerExecution && (
        <TextGenerationResultViewer
          result={viewerResult}
          execution={viewerExecution}
          onClose={handleCloseResultViewer}
        />
      )}
    </div>
  );
}
