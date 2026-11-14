'use client';

import { MessageActionsContainer } from '@components/ui/message-actions-container';

import React from 'react';

import { CopyButton } from './buttons/copy-button';
import { EditButton } from './buttons/edit-button';

interface UserMessageActionsProps {
  messageId: string;
  content: string;
  onEdit?: () => void;
  className?: string;
  // Tooltip configuration
  tooltipSize?: 'sm' | 'md';
  showTooltipArrow?: boolean;
}

/**
 * User message action buttons component
 *
 * Combines copy and edit buttons for the user message action area.
 */
export const UserMessageActions: React.FC<UserMessageActionsProps> = ({
  content,
  onEdit,
  className,
  tooltipSize = 'sm',
  showTooltipArrow = false,
}) => {
  return (
    <MessageActionsContainer align="right" className={className}>
      <CopyButton
        content={content}
        tooltipSize={tooltipSize}
        showTooltipArrow={showTooltipArrow}
      />
      {onEdit && (
        <EditButton
          onEdit={onEdit}
          tooltipSize={tooltipSize}
          showTooltipArrow={showTooltipArrow}
        />
      )}
    </MessageActionsContainer>
  );
};
