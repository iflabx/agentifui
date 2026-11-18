import type { ChatMessage } from '@lib/stores/chat-store';

import React from 'react';

type ChatInterfaceLike = {
  messages: ChatMessage[];
  handleSubmit: (
    message: string,
    files?: unknown[],
    inputs?: Record<string, unknown>
  ) => Promise<unknown>;
  isProcessing: boolean;
  handleStopProcessing: () => Promise<unknown> | unknown;
  sendDirectMessage: (messageText: string, files?: unknown[]) => Promise<void>;
};

type ChatflowNodeLike = {
  status?: string;
  startTime?: number | null;
};

type ChatflowInterfaceLike = ChatInterfaceLike & {
  nodeTracker: {
    nodes: ChatflowNodeLike[];
    isExecuting: boolean;
    executionProgress: {
      current: number;
      total: number;
      percentage: number;
    };
    error: string | null;
  };
};

interface UseChatflowStateInput {
  scope?: string;
  retainCompletedExecution?: boolean;
  isChatflowApp: boolean;
  chatflowInterface: ChatflowInterfaceLike;
  regularInterface: ChatInterfaceLike;
}

/**
 * Chatflow state management hook
 *
 * Features:
 * - Selects the correct interface based on app type
 * - Manages node tracker display state
 * - Automatically responds to node execution state
 * - Supports not auto-opening tracker if user manually closed it
 */
export function useChatflowState({
  scope = '',
  retainCompletedExecution = false,
  isChatflowApp,
  chatflowInterface,
  regularInterface,
}: UseChatflowStateInput) {
  const chatInterface = isChatflowApp ? chatflowInterface : regularInterface;
  const nodeTracker = isChatflowApp
    ? chatflowInterface.nodeTracker
    : {
        nodes: [],
        isExecuting: false,
        executionProgress: { current: 0, total: 0, percentage: 0 },
        error: null,
      };
  const executionStart = nodeTracker.nodes[0]?.startTime ?? null;
  const hasActiveNodes =
    (nodeTracker.isExecuting || retainCompletedExecution) &&
    nodeTracker.nodes.length > 0;
  const [visibility, setVisibility] = React.useState({
    scope,
    executionStart,
    executing: nodeTracker.isExecuting,
    manual: false,
    show: hasActiveNodes,
  });
  const contextChanged = visibility.scope !== scope;
  const executionChanged = visibility.executionStart !== executionStart;
  const executingChanged = visibility.executing !== nodeTracker.isExecuting;
  const executionStarted = !visibility.executing && nodeTracker.isExecuting;
  const waitingForFirstNode =
    visibility.executing &&
    nodeTracker.isExecuting &&
    visibility.executionStart === null &&
    executionStart !== null;
  const preserveManualChoice =
    !contextChanged && waitingForFirstNode && visibility.manual;
  let showNodeTracker = visibility.show;
  if (contextChanged || executionChanged || executingChanged) {
    showNodeTracker = contextChanged
      ? retainCompletedExecution && hasActiveNodes
      : preserveManualChoice
        ? visibility.show
        : executionStarted || executionChanged
          ? hasActiveNodes
          : visibility.show;
    setVisibility({
      scope,
      executionStart,
      executing: nodeTracker.isExecuting,
      show: showNodeTracker,
      manual:
        preserveManualChoice ||
        (!contextChanged &&
          !executionStarted &&
          !executionChanged &&
          visibility.manual),
    });
  }
  const setShowNodeTracker = React.useCallback(
    (show: boolean) =>
      setVisibility({
        scope,
        executionStart,
        executing: nodeTracker.isExecuting,
        manual: true,
        show,
      }),
    [scope, executionStart, nodeTracker.isExecuting]
  );
  return {
    messages: chatInterface.messages,
    handleSubmit: chatInterface.handleSubmit,
    isProcessing: chatInterface.isProcessing,
    handleStopProcessing: chatInterface.handleStopProcessing,
    sendDirectMessage: chatInterface.sendDirectMessage,
    nodeTracker,
    showNodeTracker: isChatflowApp && showNodeTracker,
    setShowNodeTracker,
    showFloatingController: isChatflowApp,
  };
}
