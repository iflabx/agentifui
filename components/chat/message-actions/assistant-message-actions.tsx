'use client';

import { MessageActionsContainer } from '@components/ui/message-actions-container';
import { cn } from '@lib/utils';

import React from 'react';

import { CopyButton } from './buttons/copy-button';
import { FeedbackButton } from './buttons/feedback-button';
import { RegenerateButton } from './buttons/regenerate-button';
import { useFeedbackManager } from './hooks/use-feedback-manager';

interface AssistantMessageActionsProps {
  messageId: string;
  content?: string;
  onRegenerate?: () => void;
  onFeedback?: (isPositive: boolean) => void;
  isRegenerating?: boolean;
  className?: string;
  // Tooltip configuration
  tooltipSize?: 'sm' | 'md';
  showTooltipArrow?: boolean;
}

/**
 * Assistant message action buttons component
 *
 * Combines copy, regenerate, and feedback buttons for the assistant message action area.
 *
 * Chain-of-thought support:
 * - For messages containing chain-of-thought, only the main content is copied, excluding reasoning in <think> and <details> tags.
 * - When the chain-of-thought is incomplete, the copy button is hidden to avoid copying incomplete content.
 */
export const AssistantMessageActions: React.FC<
  AssistantMessageActionsProps
> = ({
  content,
  onRegenerate,
  onFeedback,
  isRegenerating = false,
  className,
  tooltipSize = 'sm',
  showTooltipArrow = false,
}) => {
  // Use feedback manager hook for exclusive feedback selection
  const { selectedFeedback, handleFeedback, shouldShowButton } =
    useFeedbackManager(onFeedback);

  // Check if there is content to copy
  const hasContentToCopy = content && content.trim().length > 0;

  return (
    <MessageActionsContainer
      align="left"
      isAssistantMessage={true}
      className={className}
    >
      {/* Copy button - always shown, but disabled if no content */}
      <CopyButton
        content={content}
        disabled={!hasContentToCopy}
        tooltipSize={tooltipSize}
        showTooltipArrow={showTooltipArrow}
      />
      {onRegenerate && (
        <RegenerateButton
          onRegenerate={onRegenerate}
          isRegenerating={isRegenerating}
          tooltipSize={tooltipSize}
          showTooltipArrow={showTooltipArrow}
        />
      )}

      {/* Divider - uses a deeper color, less visible in dark mode */}
      {onFeedback && (
        <div
          className={cn(
            'mx-1 self-stretch border-r border-gray-200/50 dark:border-gray-800/50'
          )}
        />
      )}

      {/* Feedback buttons - exclusive, only one shown at a time */}
      {onFeedback && shouldShowButton(true) && (
        <FeedbackButton
          onFeedback={() => handleFeedback(true)}
          isPositive={true}
          active={selectedFeedback === true}
          tooltipSize={tooltipSize}
          showTooltipArrow={showTooltipArrow}
        />
      )}
      {onFeedback && shouldShowButton(false) && (
        <FeedbackButton
          onFeedback={() => handleFeedback(false)}
          isPositive={false}
          active={selectedFeedback === false}
          tooltipSize={tooltipSize}
          showTooltipArrow={showTooltipArrow}
        />
      )}
    </MessageActionsContainer>
  );
};
