'use client';

import { TypingDots } from '@components/ui/typing-dots';
import { useChatBottomSpacing, useChatWidth } from '@lib/hooks';
import { useChatScrollStore } from '@lib/stores/chat-scroll-store';
import { ChatMessage } from '@lib/stores/chat-store';
import { cn } from '@lib/utils';

import React, { useEffect, useRef } from 'react';

import { MessageSkeleton } from './message-skeleton';
import { AssistantMessage, UserMessage } from './messages';

/**
 * ChatLoader component props
 * @description Defines the props interface for the ChatLoader component
 */
interface ChatLoaderProps {
  /** List of chat messages */
  messages: ChatMessage[];
  /** Original conversation app context for historical attachment preview */
  conversationAppId?: string | null;
  /** Whether waiting for response */
  isWaitingForResponse?: boolean;
  /** Whether initial loading is in progress */
  isLoadingInitial?: boolean;
  /** Custom CSS class name */
  className?: string;
}

/**
 * ChatLoader component
 * @description Responsible for rendering the chat message list, supports streaming updates and auto scroll management
 *
 * @features
 * - Auto scroll to latest message
 * - Supports streaming message updates
 * - Responsive layout
 * - Skeleton loading state
 * - Waiting for response animation
 *
 * @future planned features
 * - Rich text message rendering
 * - Message timestamp display
 * - Message status indicators (sending, delivered, read)
 * - Message actions (like, copy, regenerate)
 * - Support for images, files, and other media messages
 * - Message quoting and reply
 * - Message search and filtering
 */
export const ChatLoader = ({
  messages,
  conversationAppId,
  isWaitingForResponse = false,
  isLoadingInitial = false,
  className,
}: ChatLoaderProps) => {
  const { widthClass, paddingClass } = useChatWidth();
  const { paddingBottomStyle } = useChatBottomSpacing();

  // Ref for the bottom of the message container, used for scroll-to-bottom
  const messagesEndRef = useRef<HTMLDivElement>(null);
  // Ref for the message container, used for scrollToBottom
  const containerRef = useRef<HTMLDivElement>(null);
  // Ref for previous message count, used to detect new messages
  const prevMessagesCountRef = useRef<number>(0);
  // Ref to mark initial load completion
  const initialLoadCompletedRef = useRef<boolean>(false);

  // Chat scroll store methods
  const scrollToBottom = useChatScrollStore(state => state.scrollToBottom);
  const resetScrollState = useChatScrollStore(state => state.resetScrollState);
  const setScrollRef = useChatScrollStore(state => state.setScrollRef);

  // Set scroll container ref
  useEffect(() => {
    if (containerRef.current) {
      setScrollRef({ current: containerRef.current });
    }
  }, [setScrollRef]);

  // On initial load complete
  useEffect(() => {
    if (
      !isLoadingInitial &&
      messages.length > 0 &&
      !initialLoadCompletedRef.current
    ) {
      // Mark initial load as completed
      initialLoadCompletedRef.current = true;

      // Use multiple attempts to ensure scroll to bottom
      requestAnimationFrame(() => {
        // First try using store method
        resetScrollState();

        // Then directly manipulate DOM to ensure scroll to bottom
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;

            // Try again after a short delay to ensure scroll to bottom
            setTimeout(() => {
              if (containerRef.current) {
                containerRef.current.scrollTop =
                  containerRef.current.scrollHeight;
              }
            }, 50);
          }
        });
      });
    }
  }, [isLoadingInitial, messages.length, resetScrollState]);

  // When message count changes
  useEffect(() => {
    // If there are new messages, scroll to bottom
    if (
      messages.length > prevMessagesCountRef.current &&
      initialLoadCompletedRef.current
    ) {
      // Use smooth scroll effect
      scrollToBottom('smooth');
    }

    // Update previous message count ref
    prevMessagesCountRef.current = messages.length;
  }, [messages.length, scrollToBottom]);

  // Ensure scroll to bottom after loading is complete
  useEffect(() => {
    // Listen for loading state changing from true to false
    if (!isLoadingInitial && initialLoadCompletedRef.current) {
      requestAnimationFrame(() => {
        resetScrollState();

        // Again, directly manipulate DOM to ensure scroll to bottom
        requestAnimationFrame(() => {
          if (containerRef.current) {
            containerRef.current.scrollTop = containerRef.current.scrollHeight;
          }
        });
      });
    }
  }, [isLoadingInitial, resetScrollState]);

  return (
    <div className={cn('mx-auto w-full', widthClass, paddingClass, className)}>
      <div className="space-y-2 pt-4" style={paddingBottomStyle}>
        {isLoadingInitial ? (
          // Show skeleton loading
          <MessageSkeleton />
        ) : (
          <>
            {messages.map(msg =>
              msg.isUser ? (
                <UserMessage
                  key={msg.id}
                  content={msg.text}
                  attachments={msg.attachments}
                  conversationAppId={conversationAppId}
                  id={msg.id}
                />
              ) : (
                <AssistantMessage
                  key={msg.id}
                  content={msg.text}
                  isStreaming={msg.isStreaming ?? false}
                  wasManuallyStopped={msg.wasManuallyStopped ?? false}
                  metadata={msg.metadata}
                  id={msg.id}
                />
              )
            )}

            {isWaitingForResponse && (
              <div className="my-2 flex justify-start py-2">
                <TypingDots size="lg" />
              </div>
            )}
          </>
        )}

        {/* This div is used for scroll positioning, always stays at the bottom of the message list */}
        <div ref={messagesEndRef} className="h-0" />
      </div>
    </div>
  );
};
