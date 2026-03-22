'use client';

// --- Integrate real node status ---
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';
import { cn } from '@lib/utils';
import { Loader2, Play } from 'lucide-react';

import React, { useEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { ExecutionBar } from './execution-bar';
import { ResultViewer } from './result-viewer';
import { UnifiedStatusPanel } from './unified-status-panel';

interface WorkflowTrackerProps {
  isExecuting: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic execution result structure
  executionResult: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Dynamic execution object structure
  currentExecution: any;
  autoOpenResult?: boolean;
  openResultSignal?: number;
  forceShowResult?: boolean;
  onStop?: () => void;
  onRetry?: () => void;
  onReset?: () => void;
  onCloseResult?: () => void;
}

/**
 * Workflow node tracker component
 *
 * Features:
 * - Real-time display of workflow execution status
 * - Fine-grained node progress tracking
 * - Execution result display
 * - Support SSE event handling
 * - Unified status panel (merged control panel and status display)
 */
export function WorkflowTracker({
  isExecuting,
  executionResult,
  currentExecution,
  autoOpenResult = true,
  openResultSignal = 0,
  forceShowResult = false,
  onStop,
  onRetry,
  onReset,
  onCloseResult,
}: WorkflowTrackerProps) {
  const tStatus = useTranslations('pages.workflow.status');
  const tForm = useTranslations('pages.workflow.form');
  const tNodeStatus = useTranslations('pages.workflow.nodeStatus');
  const [showResult, setShowResult] = useState(false);

  // --- Get real node status from store ---
  const nodes = useWorkflowExecutionStore(state => state.nodes);
  const progress = useWorkflowExecutionStore(state => state.executionProgress);
  const error = useWorkflowExecutionStore(state => state.error);
  const canRetry = useWorkflowExecutionStore(state => state.canRetry);
  const iterationExpandedStates = useWorkflowExecutionStore(
    state => state.iterationExpandedStates
  );
  const loopExpandedStates = useWorkflowExecutionStore(
    state => state.loopExpandedStates
  );

  // 🎯 Filter and group nodes: control the display of nodes in iteration/loop based on the expanded state
  const getVisibleNodes = () => {
    const visibleNodes = [];

    for (const node of nodes) {
      // 🎯 Container nodes (iteration/loop/parallel branch) always display
      if (node.isIterationNode || node.isLoopNode || node.isParallelNode) {
        visibleNodes.push(node);
      }
      // Non-nested nodes always display
      else if (!node.isInIteration && !node.isInLoop) {
        visibleNodes.push(node);
      }
      // Sub-nodes in iteration: determine whether to display based on the expanded state of the container
      else if (node.isInIteration) {
        // Nodes in iteration: need to find the corresponding iteration container node
        const iterationNode = nodes.find(
          n =>
            n.isIterationNode &&
            n.id !== node.id &&
            // Simple judgment: if the iteration node is before the current node, it is considered to be its container
            nodes.indexOf(n) < nodes.indexOf(node)
        );

        // If the iteration container node is found and expanded, display the nodes in this iteration
        if (iterationNode && iterationExpandedStates[iterationNode.id]) {
          visibleNodes.push(node);
        }
      }
      // Sub-nodes in loop: determine whether to display based on the expanded state of the container
      else if (node.isInLoop) {
        // Nodes in loop: need to find the corresponding loop container node
        const loopNode = nodes.find(
          n =>
            n.isLoopNode &&
            n.id !== node.id &&
            // Simple judgment: if the loop node is before the current node, it is considered to be its container
            nodes.indexOf(n) < nodes.indexOf(node)
        );

        // If the loop container node is found and expanded, display the nodes in this loop
        if (loopNode && loopExpandedStates[loopNode.id]) {
          visibleNodes.push(node);
        }
      }
    }

    return visibleNodes;
  };

  // --- Automatically open result viewer ---
  const prevExecutionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!autoOpenResult) {
      return;
    }

    const currentExecutionId =
      currentExecution?.id || currentExecution?.task_id;

    if (
      !isExecuting &&
      currentExecution &&
      executionResult &&
      currentExecutionId &&
      prevExecutionRef.current !== currentExecutionId
    ) {
      setShowResult(true);
      prevExecutionRef.current = currentExecutionId;
    }
  }, [
    isExecuting,
    currentExecution,
    currentExecution?.id,
    currentExecution?.task_id,
    executionResult,
    autoOpenResult,
  ]);

  useEffect(() => {
    if (!openResultSignal || !currentExecution || !executionResult) {
      return;
    }

    setShowResult(true);
  }, [currentExecution, executionResult, openResultSignal]);

  const shouldShowResult = forceShowResult || showResult;

  return (
    <div className="flex h-full flex-col">
      {/* --- Unified status panel --- */}
      {(onStop || onRetry || onReset) &&
        (isExecuting || currentExecution || error) && (
          <UnifiedStatusPanel
            isExecuting={isExecuting}
            progress={progress}
            error={error}
            canRetry={canRetry}
            currentExecution={currentExecution}
            onStop={onStop || (() => {})}
            onRetry={onRetry || (() => {})}
            onReset={onReset || (() => {})}
            onShowResult={() => setShowResult(true)}
          />
        )}

      {/* --- Node list --- */}
      <div className="flex-1 overflow-y-auto px-6 pt-2 pb-4">
        {!isExecuting && !currentExecution && nodes.length === 0 ? (
          // Empty state
          <div className="flex h-full items-center justify-center">
            <div className="space-y-4 text-center">
              <div
                className={cn(
                  'mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed',
                  'border-stone-300 dark:border-stone-600'
                )}
              >
                <Play
                  className={cn(
                    'h-6 w-6',
                    'text-stone-500 dark:text-stone-400'
                  )}
                />
              </div>
              <div className="space-y-2">
                <h3
                  className={cn(
                    'font-serif text-lg font-semibold',
                    'text-stone-800 dark:text-stone-200'
                  )}
                >
                  {tStatus('pending')}
                </h3>
                <p
                  className={cn(
                    'font-serif text-sm',
                    'text-stone-600 dark:text-stone-400'
                  )}
                >
                  {tForm('startExecution')}
                </p>
              </div>
            </div>
          </div>
        ) : (
          // Node progress list
          <div className="space-y-4">
            <div className="mb-4 flex items-center gap-2">
              <h3
                className={cn(
                  'font-serif text-lg font-semibold',
                  'text-stone-800 dark:text-stone-200'
                )}
              >
                {tForm('executing')}
              </h3>
            </div>

            {/* If there is no real node data, display a simple placeholder */}
            {nodes.length === 0 && (isExecuting || currentExecution) ? (
              <div
                className={cn(
                  'rounded-lg border-2 border-dashed p-4',
                  'border-stone-300 bg-stone-50 dark:border-stone-600 dark:bg-stone-800/50'
                )}
              >
                <div className="flex items-center gap-3">
                  <Loader2
                    className={cn(
                      'h-5 w-5 animate-spin',
                      'text-stone-600 dark:text-stone-400'
                    )}
                  />
                  <div>
                    <div
                      className={cn(
                        'font-serif font-medium',
                        'text-stone-800 dark:text-stone-200'
                      )}
                    >
                      {tStatus('running')}
                    </div>
                    <div
                      className={cn(
                        'font-serif text-sm',
                        'text-stone-600 dark:text-stone-400'
                      )}
                    >
                      {tNodeStatus('waitingParallel')}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              // 🎯 Display filtered node data: control the display of nodes in iteration/loop based on the expanded state
              getVisibleNodes().map((node, index) => (
                <ExecutionBar
                  key={node.id}
                  node={node}
                  index={index}
                  delay={index * 200} // Each bar appears after a delay of 200ms
                />
              ))
            )}
          </div>
        )}
      </div>

      {/* --- Result viewer --- */}
      {shouldShowResult && executionResult && (
        <ResultViewer
          result={executionResult}
          execution={currentExecution}
          onClose={() => {
            if (forceShowResult && onCloseResult) {
              onCloseResult();
              return;
            }

            setShowResult(false);
          }}
        />
      )}
    </div>
  );
}
