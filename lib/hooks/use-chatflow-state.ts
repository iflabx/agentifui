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
  isChatflowApp,
  chatflowInterface,
  regularInterface,
}: UseChatflowStateInput) {
  // Select the correct chat interface based on app type
  const chatInterface = isChatflowApp ? chatflowInterface : regularInterface;

  // nodeTracker is only valid in chatflow apps
  const nodeTracker = isChatflowApp
    ? chatflowInterface.nodeTracker
    : {
        nodes: [],
        isExecuting: false,
        executionProgress: { current: 0, total: 0, percentage: 0 },
        error: null,
      };

  // State for node tracker visibility
  const [showNodeTracker, setShowNodeTracker] = React.useState(false);

  // Track if user has manually closed the tracker popup
  // If user closes, new executions will not auto-open the tracker
  const [userHasClosed, setUserHasClosed] = React.useState(false);

  // Floating controller is always shown in chatflow apps
  const showFloatingController = isChatflowApp;

  // Only auto-show tracker when execution actually starts and user hasn't closed it
  // Avoids auto-popup when switching between chatflow apps or loading historical data
  React.useEffect(() => {
    if (!isChatflowApp) return;

    const isExecuting = nodeTracker?.isExecuting;
    const nodes = nodeTracker?.nodes || [];

    // Only auto-show tracker for fresh executions, not historical data
    if (isExecuting && !userHasClosed) {
      const currentTime = Date.now();
      const hasRecentExecution = nodes.some(
        node => node.startTime && currentTime - node.startTime < 30000 // 30 seconds
      );

      // Only auto-show for recent executions (not historical conversations)
      if (hasRecentExecution) {
        setShowNodeTracker(true);
      }
    }
  }, [
    isChatflowApp,
    nodeTracker?.isExecuting,
    nodeTracker?.nodes,
    userHasClosed,
  ]);

  // Wrap setShowNodeTracker to track user's manual actions
  const handleToggleNodeTracker = React.useCallback(
    (show: boolean) => {
      setShowNodeTracker(show);

      // If user manually closes (from true to false), record this state
      if (!show && showNodeTracker) {
        setUserHasClosed(true);
      }

      // If user manually opens (from false to true), reset closed state
      if (show && !showNodeTracker) {
        setUserHasClosed(false);
      }
    },
    [showNodeTracker]
  );

  // Reset user closed state when a new execution starts
  // This allows tracker to auto-show for each new conversation
  // But avoid resetting for historical conversations
  React.useEffect(() => {
    if (!isChatflowApp) return;

    const isExecuting = nodeTracker?.isExecuting;
    const nodes = nodeTracker?.nodes || [];

    // Only reset user closed state for new executions (not historical data)
    // Check if this is a fresh execution by looking at node execution start time
    const hasActiveExecution =
      isExecuting &&
      nodes.some(
        node => node.status === 'running' || node.status === 'completed'
      );

    // Only reset for truly new executions, not when loading historical data
    if (hasActiveExecution && isExecuting) {
      const currentTime = Date.now();
      const recentExecution = nodes.some(
        node => node.startTime && currentTime - node.startTime < 30000 // 30 seconds
      );

      if (recentExecution) {
        setUserHasClosed(false);
      }
    }
  }, [isChatflowApp, nodeTracker?.isExecuting, nodeTracker?.nodes]);

  return {
    // Chat interface
    messages: chatInterface.messages,
    handleSubmit: chatInterface.handleSubmit,
    isProcessing: chatInterface.isProcessing,
    handleStopProcessing: chatInterface.handleStopProcessing,
    sendDirectMessage: chatInterface.sendDirectMessage,

    // Chatflow related
    nodeTracker,
    showNodeTracker,
    setShowNodeTracker: handleToggleNodeTracker, // Use wrapped function
    showFloatingController,
  };
}
