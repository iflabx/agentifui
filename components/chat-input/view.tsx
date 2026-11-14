'use client';

import { ArrowUpIcon, Loader2, Square } from 'lucide-react';

import { type ReactNode, useCallback, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { ChatButton } from './button';
import { ChatContainer } from './container';
import { ChatButtonArea, ChatTextArea } from './layout';
import { ChatTextInput } from './text-input';

export interface ChatInputViewProps {
  value: string;
  onValueChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  disabled?: boolean;
  isProcessing?: boolean;
  onStop?: () => void;
  className?: string;
  placeholder?: string;
  isWelcomeScreen?: boolean;
  widthClass?: string;
  attachmentPreview?: ReactNode;
  attachmentAction?: ReactNode;
  modelSelector?: ReactNode;
  maxHeight?: number;
  isWaiting?: boolean;
  isTransitioningToWelcome?: boolean;
  onHeightChange?: (height: number) => void;
  sendButtonAriaLabel?: string;
  onInputRef?: (node: HTMLTextAreaElement | null) => void;
}

export function ChatInputView({
  value,
  onValueChange,
  onSubmit,
  disabled = false,
  isProcessing = false,
  onStop,
  className,
  placeholder,
  isWelcomeScreen = false,
  widthClass = 'max-w-3xl',
  attachmentPreview,
  attachmentAction,
  modelSelector,
  maxHeight = 300,
  isWaiting = false,
  isTransitioningToWelcome,
  onHeightChange,
  sendButtonAriaLabel,
  onInputRef,
}: ChatInputViewProps) {
  const t = useTranslations('pages.chat');
  const composing = useRef(false);
  const submitting = useRef(false);
  const [pending, setPending] = useState(false);
  const inputRef = useCallback(
    (node: HTMLTextAreaElement | null) => onInputRef?.(node),
    [onInputRef]
  );
  const submit = async () => {
    if (
      disabled ||
      isProcessing ||
      isWaiting ||
      composing.current ||
      submitting.current ||
      !value.trim()
    )
      return;
    submitting.current = true;
    setPending(true);
    try {
      await onSubmit();
    } finally {
      submitting.current = false;
      setPending(false);
    }
  };
  const stopping = isProcessing && Boolean(onStop);
  const busy = isWaiting || pending;
  return (
    <ChatContainer
      className={className}
      widthClass={widthClass}
      isWelcomeScreen={isWelcomeScreen}
      isTransitioningToWelcome={isTransitioningToWelcome}
    >
      {attachmentPreview}
      <ChatTextArea>
        <ChatTextInput
          ref={inputRef}
          value={value}
          onChange={event => onValueChange(event.target.value)}
          placeholder={placeholder}
          maxHeight={maxHeight}
          disabled={disabled}
          onHeightChange={onHeightChange}
          onCompositionStart={() => {
            composing.current = true;
          }}
          onCompositionEnd={() => {
            composing.current = false;
          }}
          onKeyDown={event => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !composing.current &&
              !event.nativeEvent.isComposing &&
              event.keyCode !== 229
            ) {
              event.preventDefault();
              void submit();
            }
          }}
        />
      </ChatTextArea>
      <div className="px-4">
        <ChatButtonArea>
          <div className="flex-none">{attachmentAction}</div>
          <div className="flex flex-1 items-center justify-end space-x-2">
            {modelSelector}
            <ChatButton
              icon={
                stopping ? (
                  <Square className="h-5 w-5" />
                ) : busy || isProcessing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <ArrowUpIcon className="h-5 w-5" />
                )
              }
              variant="submit"
              onClick={
                stopping
                  ? onStop
                  : () => {
                      void submit();
                    }
              }
              disabled={
                stopping
                  ? disabled
                  : disabled || busy || isProcessing || !value.trim()
              }
              ariaLabel={
                stopping
                  ? t('input.stopGeneration')
                  : sendButtonAriaLabel || t('input.sendMessage')
              }
              forceActiveStyle={busy}
            />
          </div>
        </ChatButtonArea>
      </div>
    </ChatContainer>
  );
}
