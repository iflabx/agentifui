'use client';

import { INITIAL_INPUT_HEIGHT } from '@lib/stores/chat-layout-store';
import { cn } from '@lib/utils';

import { forwardRef, useCallback, useEffect, useRef } from 'react';

import { useTranslations } from 'next-intl';

interface ChatTextInputProps {
  value: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  maxHeight?: number;
  className?: string;
  onCompositionStart?: (e: React.CompositionEvent<HTMLTextAreaElement>) => void;
  onCompositionEnd?: (e: React.CompositionEvent<HTMLTextAreaElement>) => void;
  onHeightChange?: (height: number) => void;
  disabled?: boolean;
  readOnly?: boolean;
}

export const ChatTextInput = forwardRef<
  HTMLTextAreaElement,
  ChatTextInputProps
>(
  (
    {
      value,
      onChange,
      onKeyDown,
      placeholder,
      maxHeight = 180,
      className,
      onCompositionStart,
      onCompositionEnd,
      onHeightChange,
      disabled,
      readOnly,
    },
    ref
  ) => {
    const t = useTranslations('pages.chat');
    const defaultPlaceholder = placeholder || t('input.placeholder');

    // Internal reference, used when no external ref is provided
    const internalRef = useRef<HTMLTextAreaElement>(null);

    // Get the currently available reference
    const getTextarea = () => {
      if (ref && typeof ref === 'object' && ref.current) {
        return ref.current;
      }
      return internalRef.current;
    };

    // Height adjustment logic
    const updateHeight = useCallback(() => {
      const textarea = getTextarea();
      if (!textarea) return;

      // Save current selection position and scroll position
      const selectionStart = textarea.selectionStart;
      const selectionEnd = textarea.selectionEnd;
      const scrollTop = textarea.scrollTop;

      // Reset height to accurately calculate scrollHeight
      textarea.style.height = '0';

      // Get scrollHeight and set new height
      const scrollHeight = textarea.scrollHeight;
      const newHeight = Math.min(scrollHeight, maxHeight);
      textarea.style.height = `${newHeight}px`;

      // Restore selection position and scroll position
      textarea.setSelectionRange(selectionStart, selectionEnd);
      textarea.scrollTop = scrollTop;

      // Notify parent component of height change
      if (onHeightChange) {
        onHeightChange(Math.max(newHeight, INITIAL_INPUT_HEIGHT));
      }
    }, [maxHeight, onHeightChange, ref]);

    // Adjust height based on value change
    useEffect(() => {
      updateHeight();
    }, [value, updateHeight]);

    // Initial adjustment after component mount
    useEffect(() => {
      updateHeight();
      // Add an extra timer to adjust again after all DOM operations are completed (solve some edge cases)
      const timer = setTimeout(updateHeight, 10);
      return () => clearTimeout(timer);
    }, [updateHeight]);

    return (
      <textarea
        ref={node => {
          // Update internal reference simultaneously
          internalRef.current = node;

          // If an external ref callback is provided, also call it
          if (ref && typeof ref === 'function') {
            ref(node);
          }
        }}
        value={value}
        onChange={e => {
          onChange(e);
          // Adjust height immediately when content changes
          requestAnimationFrame(updateHeight);
        }}
        onKeyDown={onKeyDown}
        placeholder={defaultPlaceholder}
        rows={1}
        className={cn(
          'w-full resize-none border-0 bg-transparent focus:ring-0 focus:outline-none',
          'min-h-[48px] overflow-y-auto',
          'font-serif',
          'text-gray-900 placeholder:text-gray-500',
          'dark:text-gray-100 dark:placeholder:text-stone-400',
          className
        )}
        style={{ maxHeight: `${maxHeight}px` }}
        disabled={disabled}
        readOnly={readOnly}
        onCompositionStart={onCompositionStart}
        onCompositionEnd={onCompositionEnd}
      />
    );
  }
);

ChatTextInput.displayName = 'ChatTextInput';
