'use client';

import { Spinner } from '@components/ui/spinner';
import { useMobile } from '@lib/hooks/use-mobile';
import { cn } from '@lib/utils';

import React from 'react';

import { useTranslations } from 'next-intl';

/**
 * Status types for the ThinkBlock
 */
export type ThinkBlockStatus = 'thinking' | 'completed' | 'stopped';

/**
 * Props for the ThinkBlockHeader component
 */
interface ThinkBlockHeaderProps {
  /** Current status of the think block */
  status: ThinkBlockStatus;
  /** Whether the content area is expanded */
  isOpen: boolean;
  /** Optional single-line preview shown while thinking and collapsed */
  previewText?: string;
  /** Callback function triggered when header is clicked */
  onToggle: () => void;
}

/**
 * Header component for think blocks with status display and expand/collapse functionality
 * @description Displays thinking status with loading indicator and controls content visibility
 */
export const ThinkBlockHeader: React.FC<ThinkBlockHeaderProps> = ({
  status,
  isOpen,
  previewText,
  onToggle,
}) => {
  const isMobile = useMobile();
  const t = useTranslations('components.chat.thinkBlock');
  const isThinking = status === 'thinking';
  const showPreview = isThinking && !isOpen && Boolean(previewText);

  const getStatusText = () => {
    switch (status) {
      case 'thinking':
        return t('thinking');
      case 'stopped':
        return t('stopped');
      case 'completed':
      default:
        return t('completed');
    }
  };

  const statusText = getStatusText();

  return (
    <button
      className={cn(
        'flex items-center justify-between gap-2',
        isMobile
          ? 'w-full'
          : showPreview
            ? 'w-full sm:w-[90%] md:w-[76%] lg:w-[60%]'
            : 'max-w-[50%] min-w-[22%]',
        'mb-1 cursor-pointer rounded-md border px-3 py-1.5 text-sm',
        'focus:outline-none'
      )}
      onClick={onToggle}
      aria-expanded={isOpen}
      aria-controls="think-block-content"
      aria-label={`${statusText} - ${isOpen ? 'Collapse' : 'Expand'} think block`}
      style={{
        backgroundColor: isThinking
          ? 'var(--md-think-thinking-bg)'
          : 'var(--md-think-header-bg)',
        borderColor: isThinking
          ? 'var(--md-think-thinking-border)'
          : 'var(--md-think-header-border)',
        color: isThinking
          ? 'var(--md-think-thinking-text)'
          : 'var(--md-think-header-text)',
      }}
    >
      <div
        className={cn(
          'flex min-w-0 items-center gap-2',
          showPreview ? 'shrink-0' : 'flex-1'
        )}
      >
        <svg
          className={cn(
            'h-4 w-4 flex-shrink-0',
            isOpen ? 'rotate-90' : 'rotate-0'
          )}
          style={{
            color: isThinking
              ? 'var(--md-think-thinking-icon)'
              : 'var(--md-think-header-icon)',
          }}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M9 5l7 7-7 7"
          />
        </svg>
        <span
          className={cn(
            'min-w-0 truncate font-medium',
            showPreview ? 'shrink-0' : 'flex-1'
          )}
          title={statusText}
          style={{
            color: isThinking
              ? 'var(--md-think-thinking-text)'
              : 'var(--md-think-header-text)',
          }}
        >
          {statusText}
        </span>
      </div>

      <div
        className={cn(
          'flex min-w-0 items-center justify-end gap-2',
          showPreview && 'flex-1'
        )}
      >
        {showPreview && (
          <span
            data-testid="think-block-preview"
            className="min-w-0 flex-1 truncate text-right text-xs leading-5 opacity-80"
            title={previewText}
          >
            {previewText}
          </span>
        )}

        <div className="h-4 w-4 flex-shrink-0">
          {isThinking && (
            <Spinner
              size="md"
              className="text-current"
              aria-label={t('thinking')}
            />
          )}
        </div>
      </div>
    </button>
  );
};
