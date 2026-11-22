'use client';

import { MessageActionButton } from '@components/ui/message-action-button';
import { FiEdit2 } from 'react-icons/fi';

import React from 'react';

import { useTranslations } from 'next-intl';

import { useEditAction } from '../hooks/use-edit-action';

interface EditButtonProps {
  onEdit: () => void;
  disabled?: boolean;
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right';
  tooltipSize?: 'sm' | 'md'; // tooltip size
  showTooltipArrow?: boolean; // whether to show tooltip arrow
  className?: string;
}

/**
 * Edit button component
 *
 * A button component encapsulating edit functionality.
 * When clicked, it triggers the edit callback.
 */
export const EditButton: React.FC<EditButtonProps> = ({
  onEdit,
  disabled,
  tooltipPosition = 'bottom',
  tooltipSize = 'sm',
  showTooltipArrow = false,
  className,
}) => {
  const { handleEdit } = useEditAction(onEdit);
  const t = useTranslations('components.chat.editResend');

  return (
    <MessageActionButton
      icon={FiEdit2}
      label={t('action')}
      disabled={disabled}
      onClick={handleEdit}
      tooltipPosition={tooltipPosition}
      tooltipSize={tooltipSize}
      showTooltipArrow={showTooltipArrow}
      className={className}
    />
  );
};
