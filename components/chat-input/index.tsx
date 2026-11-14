'use client';

import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import {
  formatChatUiError,
  isContentModerationBlocked,
  localizeChatModerationMessage,
  reportTraceableClientError,
} from '@lib/hooks/chat-interface/error-utils';
import { isChatSubmitResult } from '@lib/hooks/chat-interface/guards';
import { useChatInputApp } from '@lib/hooks/use-chat-input-app';
import {
  registerChatInputSubmission,
  useChatInputRouteSync,
} from '@lib/hooks/use-chat-input-route-sync';
import { useChatWidth } from '@lib/hooks/use-chat-width';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import { useFileTypes } from '@lib/hooks/use-file-types';
import { useAppListStore } from '@lib/stores/app-list-store';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import {
  INITIAL_INPUT_HEIGHT,
  useChatLayoutStore,
} from '@lib/stores/chat-layout-store';
import { useNotificationStore } from '@lib/stores/ui/notification-store';
import { RotateCcw } from 'lucide-react';

import { useCallback, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { AttachmentPreviewBar } from './attachment-preview-bar';
import { ChatButton } from './button';
import { FileTypeSelector } from './file-type-selector';
import { useFocusManager } from './focus-manager';
import { buildSubmitFiles } from './helpers';
import { ModelSelectorButton } from './model-selector-button';
import { useChatInputUploads } from './use-uploads';
import { ChatInputView } from './view';

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
  const tCommon = useTranslations('common');
  const { session, loading } = useAuthSession();
  const { currentAppId, isValidatingForMessage } = useCurrentApp();
  const route = useChatInputRouteSync({
    userId: session?.user?.id,
    appId: currentAppId,
    authLoading: loading,
  });
  const { widthClass } = useChatWidth();
  const { message, setMessage, isWelcomeScreen, currentRoute } =
    useChatInputStore();
  const attachments = useAttachmentStore(state => state.files);
  const {
    instance: inputApp,
    failed: inputAppFailed,
    retry: retryInputApp,
  } = useChatInputApp(route.appId, route.ready);
  const fileConfig = useFileTypes(inputApp);
  const apps = useAppListStore(state => state.apps);
  const [submittingScope, setSubmittingScope] = useState<string | null>(null);
  const canonicalSubmittingScope = useChatInputStore(state =>
    submittingScope === null ? null : state.resolveScope(submittingScope)
  );
  const locks = useRef(new Set<string>());
  const textHeight = useRef(INITIAL_INPUT_HEIGHT);
  const barHeight = useRef(0);
  const registeredInput = useRef<React.RefObject<HTMLTextAreaElement> | null>(
    null
  );
  const inputRef = useCallback((node: HTMLTextAreaElement | null) => {
    if (node) {
      const ref = { current: node };
      registeredInput.current = ref;
      useFocusManager.getState().registerRef(ref);
    } else if (
      useFocusManager.getState().inputRef === registeredInput.current
    ) {
      useFocusManager.getState().unregisterRef();
      registeredInput.current = null;
    }
  }, []);
  const updateTextHeight = useCallback((height: number) => {
    textHeight.current = height;
    useChatLayoutStore.getState().setInputHeight(height + barHeight.current);
  }, []);
  const updateBarHeight = useCallback((height: number) => {
    barHeight.current = height;
    useChatLayoutStore.getState().setInputHeight(height + textHeight.current);
  }, []);
  const validModel =
    !requireModelValidation ||
    !showModelSelector ||
    apps.some(
      app =>
        app.instance_id === route.appId &&
        app.config?.app_metadata?.app_type === 'model'
    );
  const blockedAttachments = attachments.some(
    file => file.status !== 'success' || !file.uploadedId
  );
  const localSubmitting =
    submittingScope !== null && canonicalSubmittingScope === currentRoute;
  const disabled =
    !route.ready ||
    !session ||
    !onSubmit ||
    !validModel ||
    isValidatingForMessage;
  const waiting = isWaiting || isWaitingForResponse || localSubmitting;
  const { handleFileSelect, handleRetryUpload } = useChatInputUploads({
    scope: route.ready ? currentRoute : null,
    currentAppId: inputApp ? route.appId : null,
    sessionUserId: session?.user?.id,
    t,
  });

  const handleLocalSubmit = async () => {
    const input = useChatInputStore.getState();
    const snapshot = input.snapshot();
    if (
      disabled ||
      waiting ||
      isProcessing ||
      blockedAttachments ||
      !snapshot.message.trim() ||
      locks.current.has(snapshot.scope) ||
      !onSubmit
    )
      return;
    const files = [...useAttachmentStore.getState().getFiles(snapshot.scope)];
    const userId = session!.user.id;
    const appId = route.appId!;
    locks.current.add(snapshot.scope);
    setSubmittingScope(snapshot.scope);
    const unregister = registerChatInputSubmission(snapshot.scope);
    const isCurrent = () =>
      useChatInputStore.getState().actorId === userId &&
      useChatInputStore.getState().resolveScope(snapshot.scope) ===
        useChatInputStore.getState().currentRoute;
    const consume = () => {
      useChatInputStore.getState().consumeSnapshot(snapshot);
      useAttachmentStore.getState().consumeFiles(snapshot.scope, files);
    };
    try {
      const result = await onSubmit(snapshot.message, buildSubmitFiles(files));
      if (isChatSubmitResult(result) && result.ok) consume();
      if (isChatSubmitResult(result) && !result.ok) {
        const failure =
          localizeChatModerationMessage(
            {
              code: result.errorCode || 'REQUEST_FAILED',
              developerMessage: result.errorMessage,
            },
            (key, values) => tModeration(key, values)
          ) ||
          result.errorMessage ||
          t('input.messageSendFailed');
        const moderated = isContentModerationBlocked(result.errorCode);
        if (moderated) consume();
        if (isCurrent() && !result.surfaced)
          useNotificationStore
            .getState()
            .showNotification(failure, moderated ? 'warning' : 'error', 5000);
      }
    } catch (error) {
      const { errorMessage, errorCode, requestId } = formatChatUiError(
        error,
        t('input.messageSendFailed'),
        'frontend',
        { moderationT: (key, values) => tModeration(key, values) }
      );
      const moderated = isContentModerationBlocked(errorCode);
      if (moderated) consume();
      void reportTraceableClientError({
        code: errorCode || 'CHAT_INPUT_SUBMIT_THROWN',
        userMessage: errorMessage,
        developerMessage:
          error instanceof Error ? error.message : String(error),
        requestId,
        context: {
          component: 'chat-input',
          phase: 'submit_throw',
          currentAppId: appId,
          attachmentCount: files.length,
          messageLength: snapshot.message.length,
        },
      });
      if (isCurrent())
        useNotificationStore
          .getState()
          .showNotification(
            errorMessage,
            moderated ? 'warning' : 'error',
            3000
          );
    } finally {
      unregister();
      locks.current.delete(snapshot.scope);
      setSubmittingScope(current =>
        current === snapshot.scope ? null : current
      );
    }
  };

  return (
    <ChatInputView
      key={route.ready ? currentRoute : 'loading'}
      value={route.ready ? message : ''}
      onValueChange={setMessage}
      onSubmit={handleLocalSubmit}
      disabled={disabled}
      isProcessing={isProcessing}
      onStop={onStop}
      isWaiting={waiting || blockedAttachments}
      className={className}
      placeholder={placeholder}
      maxHeight={maxHeight}
      isWelcomeScreen={externalIsWelcomeScreen || isWelcomeScreen}
      widthClass={widthClass}
      isTransitioningToWelcome={isTransitioningToWelcome}
      onHeightChange={updateTextHeight}
      onInputRef={inputRef}
      attachmentPreview={
        route.ready ? (
          <AttachmentPreviewBar
            files={attachments}
            uploadConfig={fileConfig.uploadConfig}
            onRemove={id =>
              useAttachmentStore.getState().removeFile(id, currentRoute)
            }
            onHeightChange={updateBarHeight}
            onRetryUpload={handleRetryUpload}
          />
        ) : undefined
      }
      attachmentAction={
        inputAppFailed ? (
          <ChatButton
            onClick={retryInputApp}
            ariaLabel={`${tCommon('ui.retry')}: ${t('input.uploadFailed')}`}
            icon={<RotateCcw className="h-4 w-4" />}
          />
        ) : route.ready && inputApp ? (
          <FileTypeSelector
            config={fileConfig}
            attachmentCount={attachments.length}
            onFileSelect={handleFileSelect}
            disabled={disabled || waiting || isProcessing}
            ariaLabel={t('input.addAttachment')}
          />
        ) : undefined
      }
      modelSelector={showModelSelector ? <ModelSelectorButton /> : undefined}
    />
  );
};

export { ChatInputView } from './view';
export { ChatButton } from './button';
export { ChatTextInput } from './text-input';
export { ChatButtonArea, ChatTextArea } from './layout';
export { ChatContainer } from './container';
export { AttachmentPreviewBar } from './attachment-preview-bar';
export { AttachmentPreviewItem } from './attachment-preview-item';
export { useFocusManager } from './focus-manager';
