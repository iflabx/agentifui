'use client';

import { isChatSubmitResult } from '@lib/hooks/chat-interface/guards';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';

import { useCallback, useEffect } from 'react';

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
        useChatflowExecutionStore
          .getState()
          .setError(error instanceof Error ? error.message : 'Submit failed');
        throw error;
      }
    },
    [chatInterface, startExecution]
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
    console.log(
      '[useChatflowInterface] Start stopping processing: chat + fine-grained nodes'
    );

    try {
      // 1. Call the original chat stop method first
      await chatInterface.handleStopProcessing();
      console.log('[useChatflowInterface] Chat stop completed');

      // 2. Handle fine-grained node status stop
      const {
        stopExecution,
        nodes,
        updateNode,
        updateIteration,
        updateParallelBranch,
      } = useChatflowExecutionStore.getState();

      // Stop all running nodes
      nodes.forEach(node => {
        if (node.status === 'running') {
          console.log('[useChatflowInterface] Stopping running node:', node.id);
          updateNode(node.id, {
            status: 'failed',
            endTime: Date.now(),
            description: node.title + ' (stopped)',
          });
        }

        // Handle running nodes in iterations
        if (node.iterations) {
          node.iterations.forEach(iteration => {
            if (iteration.status === 'running') {
              console.log(
                '[useChatflowInterface] Stopping running node in iteration:',
                node.id,
                iteration.id
              );
              updateIteration(node.id, iteration.id, {
                status: 'failed',
                endTime: Date.now(),
              });
            }
          });
        }

        // Handle running nodes in parallel branches
        if (node.parallelBranches) {
          node.parallelBranches.forEach(branch => {
            if (branch.status === 'running') {
              console.log(
                '[useChatflowInterface] Stopping running node in parallel branch:',
                node.id,
                branch.id
              );
              updateParallelBranch(node.id, branch.id, {
                status: 'failed',
                endTime: Date.now(),
              });
            }
          });
        }
      });

      // 3. Stop execution status
      stopExecution();
      console.log(
        '[useChatflowInterface] Fine-grained node status stop completed'
      );
    } catch (error) {
      console.error('[useChatflowInterface] Stop processing failed:', error);
      // Try to stop execution status even if error occurs
      useChatflowExecutionStore.getState().stopExecution();
      throw error;
    }
  }, [chatInterface]);

  // Return the extended interface
  return {
    ...chatInterface,
    handleStopProcessing, // Use the overridden stop method
    handleChatflowSubmit,
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
