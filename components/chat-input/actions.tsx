import { cn } from '@lib/utils';
import { ArrowUpIcon, Loader2, Square } from 'lucide-react';

import type { ReactNode } from 'react';

import { ChatButton } from './button';
import { FileTypeSelector } from './file-type-selector';
import { ChatButtonArea } from './layout';
import { ModelSelectorButton } from './model-selector-button';

interface ChatInputActionsProps {
  attachmentAriaLabel: string;
  isLocalSubmitting: boolean;
  isProcessing: boolean;
  isUploading: boolean;
  isValidatingConfig: boolean;
  isWaiting: boolean;
  onActionClick?: () => void;
  onFileSelect: (files: FileList | null) => void;
  sendButtonAriaLabel: string;
  sendButtonDisabled: boolean;
  showButtons: boolean;
  showModelSelector: boolean;
}

export function ChatInputActions({
  attachmentAriaLabel,
  isLocalSubmitting,
  isProcessing,
  isUploading,
  isValidatingConfig,
  isWaiting,
  onActionClick,
  onFileSelect,
  sendButtonAriaLabel,
  sendButtonDisabled,
  showButtons,
  showModelSelector,
}: ChatInputActionsProps) {
  let buttonIcon: ReactNode;
  if (isLocalSubmitting || isWaiting || isValidatingConfig) {
    buttonIcon = <Loader2 className="h-5 w-5 animate-spin" />;
  } else if (isProcessing) {
    buttonIcon = <Square className="h-5 w-5" />;
  } else {
    buttonIcon = <ArrowUpIcon className="h-5 w-5" />;
  }

  return (
    <div className="px-4">
      <ChatButtonArea>
        <div
          className={cn(
            'flex-none transition-all duration-250 ease-out',
            showButtons ? 'scale-100 opacity-100' : 'scale-80 opacity-0'
          )}
          style={{ transitionDelay: showButtons ? '0ms' : '0ms' }}
        >
          <FileTypeSelector
            onFileSelect={onFileSelect}
            disabled={isUploading || isProcessing}
            ariaLabel={attachmentAriaLabel}
          />
        </div>

        <div className="flex flex-1 items-center justify-end space-x-2">
          {showModelSelector && (
            <div
              className={cn(
                'transition-all duration-250 ease-out',
                showButtons ? 'scale-100 opacity-100' : 'scale-80 opacity-0'
              )}
              style={{ transitionDelay: showButtons ? '60ms' : '0ms' }}
            >
              <ModelSelectorButton />
            </div>
          )}

          <div
            className={cn(
              'transition-all duration-250 ease-out',
              showButtons ? 'scale-100 opacity-100' : 'scale-80 opacity-0'
            )}
            style={{ transitionDelay: showButtons ? '120ms' : '0ms' }}
          >
            <ChatButton
              icon={buttonIcon}
              variant="submit"
              onClick={onActionClick}
              disabled={sendButtonDisabled}
              ariaLabel={sendButtonAriaLabel}
              forceActiveStyle={
                isLocalSubmitting || isWaiting || isValidatingConfig
              }
            />
          </div>
        </div>
      </ChatButtonArea>
    </div>
  );
}
