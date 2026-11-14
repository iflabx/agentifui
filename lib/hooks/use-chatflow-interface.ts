'use client';

import { extractFilesFromFormData as extractFormUploads } from '@components/chatflow/chatflow-input-area/helpers';
import { isWorkflowUploadOwner } from '@components/workflow/workflow-input-form/file-upload-field/helpers';
import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { isChatSubmitResult } from '@lib/hooks/chat-interface/guards';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useChatStore } from '@lib/stores/chat-store';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import { useCurrentAppStore } from '@lib/stores/current-app-store';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';

import { usePathname } from 'next/navigation';

import { useChatInputRouteSync } from './use-chat-input-route-sync';
import { useChatInterface } from './use-chat-interface';

/**
 * Chatflow interface hook
 *
 * Features:
 * - Extends useChatInterface functionality
 * - Handles conversion of form data to chat messages
 * - Maintains compatibility with existing chat logic
 * - Supports structured processing of form data
 * - Integrates node execution tracking
 */
export function useChatflowInterface(preferredRouteAppId?: string | null) {
  const pathname = usePathname() ?? '';
  const { session, loading } = useAuthSession();
  const userId = session?.user?.id;
  const actorEpoch = useChatInputStore(state => state.actorEpoch);
  const isFormRoute = Boolean(
    preferredRouteAppId && pathname === `/apps/chatflow/${preferredRouteAppId}`
  );
  const formScope = useChatInputRouteSync({
    userId,
    appId: preferredRouteAppId,
    authLoading: loading || !isFormRoute,
  });
  const view = useMemo(
    () => ({ pathname, userId, actorEpoch, preferredRouteAppId }),
    [pathname, userId, actorEpoch, preferredRouteAppId]
  );
  const activeViewRef = useRef<typeof view | null>(null);
  useLayoutEffect(() => {
    activeViewRef.current = view;
    return () => {
      if (activeViewRef.current === view) activeViewRef.current = null;
    };
  }, [view]);
  // Get node tracking related methods
  const { startExecution, handleNodeEvent, resetExecution } =
    useChatflowExecutionStore();

  // Use the base chat interface, passing the node event handler
  const chatInterface = useChatInterface(handleNodeEvent, {
    preferredRouteAppId,
  });

  /**
   * Handle Chatflow submission
   * Build the correct chat-messages API payload from query and form data
   */
  const handleChatflowSubmit = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (query: string, inputs: Record<string, any>, files?: any[]) => {
      const input = useChatInputStore.getState();
      if (
        activeViewRef.current !== view ||
        !formScope.ready ||
        !formScope.scope ||
        input.actorId !== userId ||
        input.actorEpoch !== actorEpoch ||
        input.resolveScope(formScope.scope) !== input.currentRoute
      )
        return { ok: false, errorCode: 'STALE_INPUT_SCOPE' };
      const uploadOwner = {
        app_id: formScope.appId!,
        actor_id: userId!,
        actor_epoch: actorEpoch,
      };
      const submittedFiles = [...(files || []), ...extractFormUploads(inputs)];
      if (
        submittedFiles.some(
          file =>
            typeof file.upload_file_id !== 'string' ||
            !file.upload_file_id ||
            !isWorkflowUploadOwner(file, uploadOwner)
        )
      )
        return { ok: false, errorCode: 'INVALID_ATTACHMENT_OWNER' };
      console.log('[useChatflowInterface] Handling Chatflow submit', {
        query,
        inputs,
        files,
      });

      try {
        // Step 1: Start node execution tracking
        startExecution();

        // Step 2: Build user message content (shown to user, includes query and form data summary)
        const userMessage = formatChatflowMessage(query, inputs);

        // Step 3: Prepare file data
        const difyFiles = files ? formatFilesForDify(files) : undefined;

        // Step 4: Use the modified handleSubmit to pass inputs as the third argument
        const submitResult = (await chatInterface.handleSubmit(
          userMessage,
          difyFiles,
          inputs
        )) as unknown;

        if (isChatSubmitResult(submitResult) && !submitResult.ok) {
          return submitResult;
        }

        console.log('[useChatflowInterface] Chatflow data sent successfully');
        return submitResult;
      } catch (error) {
        console.error('[useChatflowInterface] Chatflow submit failed:', error);
        // Stop execution tracking on error
        const currentInput = useChatInputStore.getState();
        if (
          activeViewRef.current === view &&
          currentInput.actorId === userId &&
          currentInput.actorEpoch === actorEpoch &&
          currentInput.resolveScope(formScope.scope) ===
            currentInput.currentRoute
        ) {
          useChatflowExecutionStore
            .getState()
            .setError(error instanceof Error ? error.message : 'Submit failed');
        }
        throw error;
      }
    },
    [chatInterface, startExecution, view, formScope, userId, actorEpoch]
  );

  // Listen to SSE events and update node status
  useEffect(() => {
    const { isWaitingForResponse } = chatInterface;

    if (isWaitingForResponse) {
      // Start execution tracking when waiting for response
      console.log(
        '[ChatflowInterface] Waiting for response, start execution tracking'
      );
      startExecution();
    } else {
      // Fix: End of streaming response does not mean node execution is complete
      // Should not force stop execution, let nodes finish naturally
      // Only call stopExecution when truly needed (e.g. user manually stops)
      console.log(
        '[ChatflowInterface] Streaming response finished, but nodes may still be running'
      );

      // No longer automatically call stopExecution, let nodes finish via node_finished event
      // This avoids marking running nodes as failed incorrectly
    }
  }, [chatInterface.isWaitingForResponse, startExecution]);

  /**
   * Override stop processing method, handle both chat stop and fine-grained node status
   */
  const handleStopProcessing = useCallback(async () => {
    const taskId = useChatStore.getState().currentTaskId;
    const actor = useChatInputStore.getState();
    if (
      activeViewRef.current !== view ||
      actor.actorId !== userId ||
      actor.actorEpoch !== actorEpoch
    ) {
      return {
        confirmed: false,
        current: false,
        ...(taskId ? { taskId } : {}),
      };
    }
    const selectedApp = useCurrentAppStore.getState().currentAppId;
    let detached = false;
    const isCurrent = () => !detached && activeViewRef.current === view;
    const unsubscribeActor = useChatInputStore.subscribe(next => {
      if (
        next.actorEpoch !== actor.actorEpoch ||
        next.actorId !== actor.actorId ||
        next.resolveScope(actor.currentRoute) !== next.currentRoute
      )
        detached = true;
    });
    const unsubscribeApp = useCurrentAppStore.subscribe(next => {
      if (next.currentAppId !== selectedApp) detached = true;
    });
    let taskCleared = false;
    const unsubscribeTask = useChatStore.subscribe(next => {
      if (!next.currentTaskId) taskCleared = true;
      else if (next.currentTaskId !== taskId || taskCleared) detached = true;
    });
    const unsubscribeExecution = useChatflowExecutionStore.subscribe(
      (next, previous) => {
        if (
          (next.nodes !== previous.nodes && next.nodes.length === 0) ||
          (!previous.isExecuting && next.isExecuting)
        )
          detached = true;
      }
    );
    try {
      const result = await chatInterface.handleStopProcessing();
      if (
        !result.confirmed ||
        !result.current ||
        !taskId ||
        result.taskId !== taskId ||
        !isCurrent()
      )
        return { ...result, current: result.current && isCurrent() };
      const {
        stopExecution,
        nodes,
        updateNode,
        updateIteration,
        updateParallelBranch,
      } = useChatflowExecutionStore.getState();

      nodes.forEach(node => {
        if (node.status === 'running') {
          updateNode(node.id, {
            status: 'failed',
            endTime: Date.now(),
            description: node.title + ' (stopped)',
          });
        }

        if (node.iterations) {
          node.iterations.forEach(iteration => {
            if (iteration.status === 'running') {
              updateIteration(node.id, iteration.id, {
                status: 'failed',
                endTime: Date.now(),
              });
            }
          });
        }

        if (node.parallelBranches) {
          node.parallelBranches.forEach(branch => {
            if (branch.status === 'running') {
              updateParallelBranch(node.id, branch.id, {
                status: 'failed',
                endTime: Date.now(),
              });
            }
          });
        }
      });

      stopExecution();
      return result;
    } finally {
      unsubscribeActor();
      unsubscribeApp();
      unsubscribeTask();
      unsubscribeExecution();
    }
  }, [chatInterface, view, userId, actorEpoch]);

  // Return the extended interface
  return {
    ...chatInterface,
    handleStopProcessing, // Use the overridden stop method
    handleChatflowSubmit,
    formIdentity: JSON.stringify([actorEpoch, userId, preferredRouteAppId]),
    // Expose node tracking related state and methods
    nodeTracker: {
      nodes: useChatflowExecutionStore(state => state.nodes),
      isExecuting: useChatflowExecutionStore(state => state.isExecuting),
      executionProgress: useChatflowExecutionStore(
        state => state.executionProgress
      ),
      error: useChatflowExecutionStore(state => state.error),
      resetExecution,
    },
  };
}

/**
 * Format Chatflow message content
 */
function formatChatflowMessage(
  query: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
  _inputs: Record<string, any>
): string {
  // Only return the user's original question, do not add form summary
  // Form data is passed via the inputs field to Dify API, should not pollute the query field
  return query;
}

/**
 * Format files to Dify format
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatFilesForDify(files: any[]): any[] {
  return files.map(file => {
    if (file.upload_file_id) {
      return {
        type: file.type || 'document',
        transfer_method: 'local_file',
        upload_file_id: file.upload_file_id,
        name: file.name,
        size: file.size,
        mime_type: file.mime_type,
        app_id: file.app_id,
        actor_id: file.actor_id,
        actor_epoch: file.actor_epoch,
      };
    }
    return file;
  });
}

/**
 * Format form data to user-friendly message content (kept for compatibility)
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any
function formatFormDataToMessage(formData: Record<string, any>): string {
  const messageParts: string[] = [];

  // Iterate form data and build structured message
  Object.entries(formData).forEach(([key, value]) => {
    if (value === null || value === undefined || value === '') {
      return; // Skip empty values
    }

    // Handle different value types
    if (Array.isArray(value)) {
      // File array or other array types
      if (value.length > 0) {
        // For files, only show file names, actual files are passed via files param
        if (value[0] && typeof value[0] === 'object' && value[0].name) {
          const fileNames = value.map(file => file.name).join(', ');
          messageParts.push(`**${key}**: ${fileNames}`);
        } else {
          messageParts.push(`**${key}**: ${value.join(', ')}`);
        }
      }
    } else if (typeof value === 'object') {
      // Object type (e.g. file object)
      if (value.name) {
        messageParts.push(`**${key}**: ${value.name}`);
      } else {
        messageParts.push(`**${key}**: ${JSON.stringify(value)}`);
      }
    } else {
      // Primitive type
      messageParts.push(`**${key}**: ${value}`);
    }
  });

  // If no valid data, return default message
  if (messageParts.length === 0) {
    return 'Start conversation';
  }

  // Build final message
  const formattedMessage = [
    'I have filled in the following information:',
    '',
    ...messageParts,
    '',
    'Please help me based on this information.',
  ].join('\n');

  return formattedMessage;
}

/**
 * Extract files from form data
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractFilesFromFormData(formData: Record<string, any>): any[] {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const files: any[] = [];

  Object.values(formData).forEach(value => {
    if (Array.isArray(value)) {
      // Check if it's a file array
      value.forEach(item => {
        if (item && typeof item === 'object' && (item.file || item.name)) {
          files.push(item);
        }
      });
    } else if (
      value &&
      typeof value === 'object' &&
      (value.file || value.name)
    ) {
      // Single file object
      files.push(value);
    }
  });

  return files;
}

/**
 * Check if form data contains files
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function hasFilesInFormData(formData: Record<string, any>): boolean {
  return extractFilesFromFormData(formData).length > 0;
}

/**
 * Get summary information of form data
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getFormDataSummary(formData: Record<string, any>): {
  fieldCount: number;
  hasFiles: boolean;
  nonEmptyFields: string[];
} {
  const nonEmptyFields: string[] = [];
  let hasFiles = false;

  Object.entries(formData).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      nonEmptyFields.push(key);

      // Check if contains files
      if (Array.isArray(value)) {
        if (
          value.some(
            item => item && typeof item === 'object' && (item.file || item.name)
          )
        ) {
          hasFiles = true;
        }
      } else if (
        value &&
        typeof value === 'object' &&
        (value.file || value.name)
      ) {
        hasFiles = true;
      }
    }
  });

  return {
    fieldCount: nonEmptyFields.length,
    hasFiles,
    nonEmptyFields,
  };
}
