'use client';

import {
  difyProcessItem,
  visibleDifyNodes,
  workflowSnapshotItems,
} from '@components/execution-process/adapters';
import { ExecutionProcessView } from '@components/execution-process/view';
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';
import type { AppExecution } from '@lib/types/database';

import { useEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { ExecutionBar } from './execution-bar';
import { ResultViewer } from './result-viewer';
import { UnifiedStatusPanel } from './unified-status-panel';

interface WorkflowTrackerProps {
  instanceId?: string;
  isExecuting: boolean;
  executionResult: unknown;
  currentExecution: AppExecution | null;
  historical?: boolean;
  autoOpenResult?: boolean;
  openResultSignal?: number;
  onStop?: () => void;
  onRetry?: () => void;
  onReset?: () => void;
  onCloseHistory?: () => void;
}

export function WorkflowTracker({
  instanceId,
  isExecuting,
  executionResult,
  currentExecution,
  historical = false,
  autoOpenResult = true,
  openResultSignal = 0,
  onStop,
  onRetry,
  onReset,
  onCloseHistory,
}: WorkflowTrackerProps) {
  const translate = useTranslations('executionProcess');
  const [showResultFor, setShowResultFor] = useState<string | null>(null);
  const nodes = useWorkflowExecutionStore(state => state.nodes);
  const liveError = useWorkflowExecutionStore(state => state.error);
  const canRetry = useWorkflowExecutionStore(state => state.canRetry);
  const iterationExpandedStates = useWorkflowExecutionStore(
    state => state.iterationExpandedStates
  );
  const loopExpandedStates = useWorkflowExecutionStore(
    state => state.loopExpandedStates
  );
  const visibleNodes = visibleDifyNodes(
    nodes,
    iterationExpandedStates,
    loopExpandedStates
  );
  const executionId = currentExecution?.id ?? null;
  const executing = !historical && isExecuting;
  const failed = historical
    ? currentExecution?.status === 'failed'
    : Boolean(liveError);
  const items = historical
    ? workflowSnapshotItems(
        currentExecution?.metadata,
        executionId || 'history'
      )
    : visibleNodes.map(node => difyProcessItem(node, executionId || 'live'));
  const previousExecution = useRef<string | null>(null);

  useEffect(() => {
    if (!autoOpenResult || executing || !executionId || !executionResult)
      return;
    if (previousExecution.current !== executionId) {
      setShowResultFor(executionId);
      previousExecution.current = executionId;
    }
  }, [autoOpenResult, executing, executionId, executionResult]);

  useEffect(() => {
    if (openResultSignal && executionId && executionResult)
      setShowResultFor(executionId);
  }, [executionId, executionResult, openResultSignal]);

  return (
    <div className="flex h-full flex-col">
      {(onStop || onRetry || onReset || historical) &&
        (executing || currentExecution || failed) && (
          <UnifiedStatusPanel
            isExecuting={executing}
            progress={0}
            error={failed ? translate('failedNotice') : null}
            canRetry={!historical && canRetry}
            currentExecution={currentExecution}
            onStop={historical ? undefined : onStop}
            onRetry={
              historical ? () => undefined : onRetry || (() => undefined)
            }
            onReset={
              historical
                ? onCloseHistory || (() => undefined)
                : onReset || (() => undefined)
            }
            onShowResult={() => setShowResultFor(executionId)}
          />
        )}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 pt-2 pb-4">
        <ExecutionProcessView
          key={JSON.stringify([historical, executionId])}
          items={items}
          completedCount={
            historical
              ? undefined
              : nodes.filter(node => node.status === 'completed').length
          }
          historical={historical}
          executing={executing}
          failed={failed}
          onClose={historical ? onCloseHistory : undefined}
          renderItem={
            historical
              ? undefined
              : (item, index) => (
                  <ExecutionBar
                    item={item}
                    node={visibleNodes[index]}
                    index={index}
                  />
                )
          }
        />
      </div>
      {executionId &&
        showResultFor === executionId &&
        executionResult !== null &&
        executionResult !== undefined && (
          <ResultViewer
            result={executionResult}
            execution={currentExecution}
            appId={instanceId}
            onClose={() => setShowResultFor(null)}
          />
        )}
    </div>
  );
}
