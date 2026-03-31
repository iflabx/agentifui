'use client';

import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { useChatWidth, useInputHeightReset } from '@lib/hooks';
import {
  formatChatUiError,
  isContentModerationBlocked,
  localizeChatModerationMessage,
  reportTraceableClientError,
} from '@lib/hooks/chat-interface/error-utils';
import { isChatSubmitResult } from '@lib/hooks/chat-interface/guards';
import { useChatInputRouteSync } from '@lib/hooks/use-chat-input-route-sync';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import { useAppListStore } from '@lib/stores/app-list-store';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import {
  INITIAL_INPUT_HEIGHT,
  useChatLayoutStore,
} from '@lib/stores/chat-layout-store';
import { useNotificationStore } from '@lib/stores/ui/notification-store';

import { useCallback, useState } from 'react';

import { useTranslations } from 'next-intl';

import { ChatInputActions } from './actions';
import { AttachmentPreviewBar } from './attachment-preview-bar';
import { ChatContainer } from './container';
import { useFocusManager } from './focus-manager';
import {
  buildSubmitFiles,
  getChatInputAriaLabel,
  shouldBlockEnterSubmit,
} from './helpers';
import { ChatTextArea } from './layout';
import { ChatTextInput } from './text-input';
import {
  useChatInputButtonVisibility,
  useChatInputFocusEffects,
  useChatInputWaitingEffect,
} from './use-effects';
import { useChatInputUploads } from './use-uploads';

interface ChatInputProps {
  className?: string;
  placeholder?: string;
  maxHeight?: number;
  onSubmit?: (
    message: string,
    files?: ReturnType<typeof buildSubmitFiles>
  ) => Promise<unknown> | unknown;
  onStop?: () => void;
  isProcessing?: boolean;
  isWaitingForResponse?: boolean;
  isWaiting?: boolean;
  isWelcomeScreen?: boolean;
  isTransitioningToWelcome?: boolean;
  requireModelValidation?: boolean;
  showModelSelector?: boolean;
}

export const ChatInput = ({
  className,
  placeholder,
  maxHeight = 300,
  onSubmit,
  onStop,
  isProcessing = false,
  isWaitingForResponse = false,
  isWaiting = false,
  isWelcomeScreen: externalIsWelcomeScreen = false,
  isTransitioningToWelcome = false,
  requireModelValidation = true,
  showModelSelector = true,
}: ChatInputProps) => {
  const t = useTranslations('pages.chat');
  const tModeration = useTranslations('errors.system.moderation');
  const defaultPlaceholder = placeholder || t('input.placeholder');
  const { widthClass } = useChatWidth();
  const { setInputHeight } = useChatLayoutStore();
  const {
    message,
    setMessage,
    clearMessage,
    isComposing,
    setIsComposing,
    isWelcomeScreen,
  } = useChatInputStore();
  const [isLocalSubmitting, setIsLocalSubmitting] = useState(false);
  const {
    files: attachments,
    addFiles,
    clearFiles: clearAttachments,
    updateFileStatus,
    updateFileUploadedId,
  } = useAttachmentStore();
  const [attachmentBarHeight, setAttachmentBarHeight] = useState(0);
  const [textAreaHeight, setTextAreaHeight] = useState(INITIAL_INPUT_HEIGHT);

  useInputHeightReset(isWelcomeScreen);
  useChatInputRouteSync();

  const inputRef = useCallback((node: HTMLTextAreaElement | null) => {
    if (node) {
      const ref = { current: node } as React.RefObject<HTMLTextAreaElement>;
      useFocusManager.getState().registerRef(ref);
    }
  }, []);

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(event.target.value);
  };

  const currentLayoutInputHeight = useChatLayoutStore(
    state => state.inputHeight
  );

  const handleTextHeightChange = useCallback(
    (newObservedHeight: number) => {
      const newCalculatedTextAreaHeight = Math.max(
        newObservedHeight,
        INITIAL_INPUT_HEIGHT
      );
      setTextAreaHeight(newCalculatedTextAreaHeight);

      const newTotalInputHeight =
        newCalculatedTextAreaHeight + attachmentBarHeight;
      if (currentLayoutInputHeight !== newTotalInputHeight) {
        setInputHeight(newTotalInputHeight);
      }
    },
    [attachmentBarHeight, currentLayoutInputHeight, setInputHeight]
  );

  const handleAttachmentBarHeightChange = useCallback(
    (newAttachmentBarHeight: number) => {
      setAttachmentBarHeight(newAttachmentBarHeight);

      const newTotalInputHeight = textAreaHeight + newAttachmentBarHeight;
      if (currentLayoutInputHeight !== newTotalInputHeight) {
        setInputHeight(newTotalInputHeight);
      }
    },
    [currentLayoutInputHeight, setInputHeight, textAreaHeight]
  );

  const { session } = useAuthSession();
  const {
    currentAppId,
    isValidating: isValidatingAppConfig,
    isValidatingForMessage: isValidatingForMessageOnly,
  } = useCurrentApp();

  const { apps } = useAppListStore();
  const availableModels = apps.filter(app => {
    const metadata = app.config?.app_metadata;
    return metadata?.app_type === 'model';
  });
  const hasAvailableModels = availableModels.length > 0;
  const currentSelectedModel = availableModels.find(
    app => app.instance_id === currentAppId
  );
  const hasValidSelectedModel = !!currentSelectedModel;
  const canSubmitWithModel =
    !requireModelValidation ||
    !showModelSelector ||
    (hasAvailableModels && hasValidSelectedModel);

  useChatInputWaitingEffect({
    clearAttachments,
    clearMessage,
    isWaiting,
    setIsLocalSubmitting,
  });

  const handleLocalSubmit = async () => {
    if (isLocalSubmitting) {
      return;
    }

    let savedMessage = '';
    let savedAttachments = [] as typeof attachments;

    try {
      setIsLocalSubmitting(true);
      savedMessage = message;
      savedAttachments = useAttachmentStore.getState().files;
      const filesToSend = buildSubmitFiles(savedAttachments);

      if (savedMessage.trim() && onSubmit) {
        const submitResult = await onSubmit(savedMessage, filesToSend);

        if (isChatSubmitResult(submitResult) && !submitResult.ok) {
          const submitFailureMessage =
            localizeChatModerationMessage(
              {
                code: submitResult.errorCode || 'REQUEST_FAILED',
                developerMessage: submitResult.errorMessage,
              },
              (key, values) => tModeration(key, values)
            ) ||
            submitResult.errorMessage ||
            `${t('input.messageSendFailed')}: ${t('input.unknownError')}`;
          const isModerationBlocked = isContentModerationBlocked(
            submitResult.errorCode
          );

          void reportTraceableClientError({
            code: submitResult.errorCode || 'CHAT_INPUT_SUBMIT_FAILED',
            userMessage: submitFailureMessage,
            developerMessage: 'ChatInput submission returned ok=false',
            requestId: submitResult.requestId,
            context: {
              component: 'chat-input',
              phase: 'submit_result',
              currentAppId: currentAppId || null,
              userId: session?.user?.id || null,
              attachmentCount: savedAttachments.length,
              messageLength: savedMessage.length,
              surfaced: Boolean(submitResult.surfaced),
            },
          });

          if (isModerationBlocked) {
            clearMessage();
            clearAttachments();
            useNotificationStore
              .getState()
              .showNotification(submitFailureMessage, 'warning', 5000);
            return;
          }

          if (!submitResult.surfaced) {
            setMessage(savedMessage);
            useAttachmentStore.getState().setFiles(savedAttachments);
            useNotificationStore
              .getState()
              .showNotification(submitFailureMessage, 'error', 5000);
          }
          return;
        }
      }
    } catch (error) {
      const { errorMessage, errorCode, requestId } = formatChatUiError(
        error,
        `${t('input.messageSendFailed')}: ${t('input.unknownError')}`,
        'frontend',
        {
          moderationT: (key, values) => tModeration(key, values),
        }
      );
      const isModerationBlocked = isContentModerationBlocked(errorCode);

      if (isModerationBlocked) {
        clearMessage();
        clearAttachments();
        void reportTraceableClientError({
          code: errorCode || 'CHAT_INPUT_SUBMIT_THROWN',
          userMessage: errorMessage,
          developerMessage:
            error instanceof Error ? error.message : String(error),
          requestId,
          context: {
            component: 'chat-input',
            phase: 'submit_throw',
            currentAppId: currentAppId || null,
            userId: session?.user?.id || null,
            attachmentCount: savedAttachments.length,
            messageLength: savedMessage.length,
          },
        });
        useNotificationStore
          .getState()
          .showNotification(errorMessage, 'warning', 3000);
        return;
      }

      setMessage(savedMessage);
      useAttachmentStore.getState().setFiles(savedAttachments);
      void reportTraceableClientError({
        code: errorCode || 'CHAT_INPUT_SUBMIT_THROWN',
        userMessage: errorMessage,
        developerMessage:
          error instanceof Error ? error.message : String(error),
        requestId,
        context: {
          component: 'chat-input',
          phase: 'submit_throw',
          currentAppId: currentAppId || null,
          userId: session?.user?.id || null,
          attachmentCount: savedAttachments.length,
          messageLength: savedMessage.length,
        },
      });
      useNotificationStore
        .getState()
        .showNotification(errorMessage, 'error', 3000);
    } finally {
      setIsLocalSubmitting(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !isComposing) {
      event.preventDefault();

      if (
        !shouldBlockEnterSubmit({
          attachments,
          canSubmitWithModel,
          isComposing,
          isLocalSubmitting,
          isProcessing,
          isValidatingAppConfig,
          isWaiting,
          message,
        })
      ) {
        void handleLocalSubmit();
      }
    }
  };

  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  const handleCompositionEnd = () => {
    setIsComposing(false);
  };

  useChatInputFocusEffects({
    externalIsWelcomeScreen,
    isProcessing,
    isWaitingForResponse,
    isWelcomeScreen,
    message,
  });

  const { handleFileSelect, handleRetryUpload } = useChatInputUploads({
    addFiles,
    currentAppId,
    sessionUserId: session?.user?.id,
    t,
    updateFileStatus,
    updateFileUploadedId,
  });

  const isUploading = attachments.some(file => file.status === 'uploading');
  const hasError = attachments.some(file => file.status === 'error');
  const isValidatingConfig = isValidatingForMessageOnly;
  const effectiveIsWelcomeScreen = externalIsWelcomeScreen || isWelcomeScreen;
  const showButtons = useChatInputButtonVisibility({
    effectiveIsWelcomeScreen,
    isLocalSubmitting,
    isProcessing,
    isTransitioningToWelcome,
  });
  const sendButtonDisabled =
    isLocalSubmitting ||
    isWaiting ||
    isValidatingConfig ||
    isUploading ||
    hasError ||
    (!isProcessing && !message.trim()) ||
    !canSubmitWithModel;
  const sendButtonAriaLabel = getChatInputAriaLabel({
    canSubmitWithModel,
    hasAvailableModels,
    hasError,
    isLocalSubmitting,
    isProcessing,
    isUploading,
    isValidatingConfig,
    isWaiting,
    requireModelValidation,
    t,
  });
  const actionClick =
    isLocalSubmitting || isWaiting || isValidatingConfig
      ? undefined
      : isProcessing
        ? onStop
        : () => {
            void handleLocalSubmit();
          };

  return (
    <ChatContainer
      isWelcomeScreen={effectiveIsWelcomeScreen}
      className={className}
      widthClass={widthClass}
      isTransitioningToWelcome={isTransitioningToWelcome}
    >
      <AttachmentPreviewBar
        onHeightChange={handleAttachmentBarHeightChange}
        onRetryUpload={handleRetryUpload}
      />

      <ChatTextArea>
        <ChatTextInput
          ref={inputRef}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={defaultPlaceholder}
          maxHeight={maxHeight}
          onCompositionStart={handleCompositionStart}
          onCompositionEnd={handleCompositionEnd}
          onHeightChange={handleTextHeightChange}
        />
      </ChatTextArea>

      <ChatInputActions
        attachmentAriaLabel={t('input.addAttachment')}
        isLocalSubmitting={isLocalSubmitting}
        isProcessing={isProcessing}
        isUploading={isUploading}
        isValidatingConfig={isValidatingConfig}
        isWaiting={isWaiting}
        onActionClick={actionClick}
        onFileSelect={handleFileSelect}
        sendButtonAriaLabel={sendButtonAriaLabel}
        sendButtonDisabled={sendButtonDisabled}
        showButtons={showButtons}
        showModelSelector={showModelSelector}
      />
    </ChatContainer>
  );
};

export { ChatButton } from './button';
export { ChatTextInput } from './text-input';
export { ChatButtonArea, ChatTextArea } from './layout';
export { ChatContainer } from './container';
export { AttachmentPreviewBar } from './attachment-preview-bar';
export { AttachmentPreviewItem } from './attachment-preview-item';
export { useFocusManager } from './focus-manager';
