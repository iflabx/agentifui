'use client';

import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { useChatWidth, useInputHeightReset } from '@lib/hooks';
import { useChatInputRouteSync } from '@lib/hooks/use-chat-input-route-sync';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import { uploadDifyFile } from '@lib/services/dify/file-service';
import type { ChatUploadFile } from '@lib/services/dify/types';
import { useAppListStore } from '@lib/stores/app-list-store';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import { AttachmentFile } from '@lib/stores/attachment-store';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useChatLayoutStore } from '@lib/stores/chat-layout-store';
import { INITIAL_INPUT_HEIGHT } from '@lib/stores/chat-layout-store';
import { useChatScrollStore } from '@lib/stores/chat-scroll-store';
import { useNotificationStore } from '@lib/stores/ui/notification-store';
import { cn } from '@lib/utils';
import { ArrowUpIcon, Loader2, Square } from 'lucide-react';
import { create } from 'zustand';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import { AttachmentPreviewBar } from './attachment-preview-bar';
import { ChatButton } from './button';
import { ChatContainer } from './container';
import { FileTypeSelector } from './file-type-selector';
import { ChatButtonArea, ChatTextArea } from './layout';
import { ModelSelectorButton } from './model-selector-button';
import { ChatTextInput } from './text-input';

// Create a global focus manager
interface FocusManagerState {
  inputRef: React.RefObject<HTMLTextAreaElement> | null;
  registerRef: (ref: React.RefObject<HTMLTextAreaElement>) => void;
  focusInput: () => void;
}

// Use Zustand to store input box references, ensuring cross-component sharing
export const useFocusManager = create<FocusManagerState>((set, get) => ({
  inputRef: null,

  // Register input box references
  registerRef: ref => {
    set({ inputRef: ref });
  },

  // Focus on input box
  focusInput: () => {
    const { inputRef } = get();
    if (inputRef?.current) {
      inputRef.current.focus();
    }
  },
}));

// Main ChatInput component
interface ChatInputProps {
  className?: string;
  placeholder?: string;
  maxHeight?: number;
  onSubmit?: (message: string, files?: ChatUploadFile[]) => void;
  onStop?: () => void;
  isProcessing?: boolean;
  isWaitingForResponse?: boolean;
  isWaiting?: boolean;
  // Whether in welcome screen state
  isWelcomeScreen?: boolean;
  // Whether transitioning from conversation interface to welcome interface
  // When true, use flashing effect instead of sliding
  isTransitioningToWelcome?: boolean;
  // 🎯 New: Whether model validation is required
  // Default is true, can be set to false in scenarios where models are not required, such as app market
  requireModelValidation?: boolean;
  // 🎯 New: Whether to show model selector
  // Default is true, may not be needed in some scenarios
  showModelSelector?: boolean;
}

export const ChatInput = ({
  className,
  placeholder,
  maxHeight = 300, // Define input box maximum height
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

  // 🎯 New: Local submission state to prevent duplicate clicks
  const [isLocalSubmitting, setIsLocalSubmitting] = useState(false);

  // 🎯 New: Button area fade-in animation state
  const [showButtons, setShowButtons] = useState(false);
  const [isInitialMount, setIsInitialMount] = useState(true);

  // Attachment state
  const {
    files: attachments,
    addFiles,
    clearFiles: clearAttachments,
    updateFileStatus,
    updateFileUploadedId,
  } = useAttachmentStore();
  // Local state, storing the height of the attachment bar and text box separately
  const [attachmentBarHeight, setAttachmentBarHeight] = useState(0);
  const [textAreaHeight, setTextAreaHeight] = useState(INITIAL_INPUT_HEIGHT);

  // Use height reset hook
  useInputHeightReset(isWelcomeScreen);

  // 🎯 New: Route sync hook, ensuring input box content is isolated by route
  useChatInputRouteSync();

  // Create input box reference
  const inputRef = useCallback((node: HTMLTextAreaElement | null) => {
    if (node) {
      // Register reference to global focus manager
      const ref = { current: node } as React.RefObject<HTMLTextAreaElement>;
      useFocusManager.getState().registerRef(ref);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
  };

  // Get current inputHeight from store for comparison
  const currentLayoutInputHeight = useChatLayoutStore(
    state => state.inputHeight
  );

  // Callback function for handling text input box height changes
  const handleTextHeightChange = useCallback(
    (newObservedHeight: number) => {
      const newCalculatedTextAreaHeight = Math.max(
        newObservedHeight,
        INITIAL_INPUT_HEIGHT
      );

      // Update local textAreaHeight state (setTextAreaHeight will automatically handle duplicate values)
      setTextAreaHeight(newCalculatedTextAreaHeight);

      // Calculate new total input height
      // attachmentBarHeight is local state of ChatInput, updated in handleAttachmentBarHeightChange
      const newTotalInputHeight =
        newCalculatedTextAreaHeight + attachmentBarHeight;

      // Only update store if calculated total height is different from current total height in store
      if (currentLayoutInputHeight !== newTotalInputHeight) {
        setInputHeight(newTotalInputHeight);
      }
    },
    [setInputHeight, attachmentBarHeight, currentLayoutInputHeight]
  ); // textAreaHeight removed from dependencies, because it is updated internally through setTextAreaHeight

  // Callback function for handling attachment preview bar height changes
  const handleAttachmentBarHeightChange = useCallback(
    (newAttachmentBarHeight: number) => {
      // Update local attachmentBarHeight state (setAttachmentBarHeight will automatically handle duplicate values)
      setAttachmentBarHeight(newAttachmentBarHeight);

      // Calculate new total input height
      // textAreaHeight is local state of ChatInput, updated in handleAttachmentBarHeightChange
      const newTotalInputHeight = textAreaHeight + newAttachmentBarHeight;

      // Only update store if calculated total height is different from current total height in store
      if (currentLayoutInputHeight !== newTotalInputHeight) {
        setInputHeight(newTotalInputHeight);
      }
    },
    [setInputHeight, textAreaHeight, currentLayoutInputHeight]
  ); // attachmentBarHeight removed from dependencies

  // User ID and App ID information
  const { session } = useAuthSession();
  const {
    currentAppId,
    isValidating: isValidatingAppConfig, // New: validation state
    isValidatingForMessage: isValidatingForMessageOnly, // New: validation state specifically for message sending
  } = useCurrentApp();

  // Check if there are available models and if a valid model is selected
  // Only check when model validation is required
  const { apps } = useAppListStore();
  const availableModels = apps.filter(app => {
    const metadata = app.config?.app_metadata;
    return metadata?.app_type === 'model';
  });
  const hasAvailableModels = availableModels.length > 0;

  // Check if currently selected model is valid
  // Fix: Use instance_id for matching, as currentAppId stores instance_id not UUID
  const currentSelectedModel = availableModels.find(
    app => app.instance_id === currentAppId
  );
  const hasValidSelectedModel = !!currentSelectedModel;

  // Fix: Only check model status when model validation is required and model selector is shown
  // History conversations don't show model selector, so no model validation needed
  const canSubmitWithModel =
    !requireModelValidation ||
    !showModelSelector ||
    (hasAvailableModels && hasValidSelectedModel);

  // 🎯 Fix: Listen to isWaiting state changes to clear input box
  // When validation succeeds and starts waiting for response, clear immediately instead of waiting for the entire streaming response to end
  // Use ref to avoid triggering duplicate clearing during the clearing process
  const previousIsWaitingRef = useRef(isWaiting);

  useEffect(() => {
    // Only clear when isWaiting changes from false to true (validation succeeds and starts waiting for response)
    if (isWaiting && !previousIsWaitingRef.current) {
      console.log(
        '[ChatInput] Detected isWaiting changed to true, clearing input box'
      );
      clearMessage();
      clearAttachments();
      useChatScrollStore.getState().scrollToBottom('smooth');
      // 🎯 Reset local submission state because it has entered the waiting for response state
      setIsLocalSubmitting(false);
    }

    // Update previous value
    previousIsWaitingRef.current = isWaiting;
  }, [isWaiting, clearMessage, clearAttachments]);

  // Submit message (fix empty timing: by listening to isWaiting state changes to clear)
  const handleLocalSubmit = async () => {
    // 🎯 Prevent duplicate clicks: if already submitting, return immediately
    if (isLocalSubmitting) {
      console.log(
        '[ChatInput] Detected duplicate click, ignoring this submission'
      );
      return;
    }

    // State backup and restore logic
    let savedMessage = '';
    let savedAttachments: AttachmentFile[] = [];

    try {
      // 🎯 Immediately set local submission state to prevent duplicate clicks
      setIsLocalSubmitting(true);

      // 1. Backup current state (before calling onSubmit)
      savedMessage = message;
      savedAttachments = useAttachmentStore.getState().files;

      // 2. Filter files to be submitted (using the backed up state)
      const uploadedFiles = savedAttachments.filter(
        f => f.status === 'success' && f.uploadedId
      );
      const files = uploadedFiles
        .filter(f => typeof f.uploadedId === 'string')
        .map(f => ({
          type: getDifyFileType(f),
          transfer_method: 'local_file',
          upload_file_id: f.uploadedId as string, // Explicitly assert as string
          name: f.name,
          size: f.size,
          mime_type: f.type,
        }));
      const filesToSend =
        Array.isArray(files) && files.length > 0 ? files : undefined;

      // 3. Check if submission is possible (using the backed up message)
      if (savedMessage.trim() && onSubmit) {
        // 🎯 Fix: No longer clearing here, but by listening to isWaiting state changes to clear
        // This clears immediately when validation succeeds, instead of waiting for the entire streaming response to end
        // Call submit function, clearing is handled by useEffect monitoring isWaiting state changes
        await onSubmit(savedMessage, filesToSend);

        // 🎯 Fix: Clear operation has been moved to useEffect, no longer needed here
        console.log('[ChatInput] Submission successful');
      } else {
        // If submission is blocked because the message is empty, the button should be disabled, but just in case
        console.log('[ChatInput] No message content to submit.');
      }
    } catch (error) {
      // Submit failed, restore state
      console.error(
        '[ChatInput] Message submission failed, executing rollback',
        error
      );
      // Fix: If validation failed (isWaiting didn't become true), need to restore state
      // If validation succeeded but subsequent failure, input has been cleared, also need to restore
      setMessage(savedMessage);
      useAttachmentStore.getState().setFiles(savedAttachments);
      // Call notification Store to show error message
      useNotificationStore.getState().showNotification(
        `${t('input.messageSendFailed')}: ${(error as Error)?.message || t('input.unknownError')}`,
        'error',
        3000 // Duration 3 seconds
      );
    } finally {
      // 🎯 Reset local submission state regardless of success or failure
      setIsLocalSubmitting(false);
    }
  };

  // --- Helper function: infer Dify file type field based on file type ---
  function getDifyFileType(
    f: AttachmentFile
  ): 'image' | 'document' | 'audio' | 'video' | 'custom' {
    const mime = f.type.toLowerCase();
    if (mime.startsWith('image/')) return 'image';
    if (mime.startsWith('audio/')) return 'audio';
    if (mime.startsWith('video/')) return 'video';
    if (
      mime === 'application/pdf' ||
      mime.includes('word') ||
      mime.includes('excel') ||
      mime.includes('csv') ||
      mime.includes('text') ||
      mime.includes('html') ||
      mime.includes('xml') ||
      mime.includes('epub') ||
      mime.includes('powerpoint')
    )
      return 'document';
    return 'custom';
  }

  // 🎯 Fix: Add validation status check before Enter submission
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !isComposing) {
      e.preventDefault();

      // Before Enter submission, perform checks consistent with button disable logic
      const shouldBlockSubmit =
        isLocalSubmitting || // New: currently submitting locally
        isWaiting || // Waiting for response
        isValidatingAppConfig || // New: validating configuration
        isProcessing || // Processing previous message
        attachments.some(f => f.status === 'uploading') || // Files uploading
        attachments.some(f => f.status === 'error') || // File upload failed
        !message.trim() || // Message is empty
        !canSubmitWithModel; // New: no available models or no valid model selected

      if (!shouldBlockSubmit) {
        handleLocalSubmit();
      }
    }
  };

  // Handle input method composition start event
  const handleCompositionStart = () => {
    setIsComposing(true);
  };

  // Handle input method composition end event
  const handleCompositionEnd = () => {
    setIsComposing(false);
  };

  // Message changes automatically focus, but avoid triggering during streaming output or input method composition
  useEffect(() => {
    // isComposing state is subscribed from store, ensuring the latest value is used
    const currentIsComposing = useChatInputStore.getState().isComposing;
    if (
      message &&
      !isProcessing &&
      !isWaitingForResponse &&
      !currentIsComposing
    ) {
      useFocusManager.getState().focusInput();
    }
    // isComposing state itself should not trigger this effect to focus,
    // but when message, isProcessing, isWaitingForResponse change, then combine the current isComposing to determine.
    // If isComposing is added to the dependency array, when isComposing changes from true to false, if other conditions are met, it will also focus, which may be expected.
    // Let's not add isComposing to the dependency first, see how it works. If more precise control is needed, adjust later.
  }, [message, isProcessing, isWaitingForResponse]);

  // Automatically focus input box when component is first mounted
  useEffect(() => {
    // Ensure focus when not in welcome screen (i.e. actual chat interface), or when user wants to focus at any time
    // Current logic: just try to focus when component is mounted
    useFocusManager.getState().focusInput();
  }, []);

  // Listen to welcome screen state changes, ensuring automatic focus when switching to new conversation
  // This solves the problem of losing focus when switching from temporary conversation to new conversation
  useEffect(() => {
    // When switching to welcome screen (new conversation), automatically focus input box
    // Add a brief delay to ensure interface transition is complete
    if (isWelcomeScreen) {
      const timer = setTimeout(() => {
        useFocusManager.getState().focusInput();
      }, 150);

      return () => clearTimeout(timer);
    }
  }, [isWelcomeScreen]);

  // Listen to external isWelcomeScreen prop changes
  // Ensure correct focus when component receives new welcome screen state
  useEffect(() => {
    // When external welcome screen state becomes true, automatically focus input box
    if (externalIsWelcomeScreen) {
      const timer = setTimeout(() => {
        useFocusManager.getState().focusInput();
      }, 150); // 150ms delay to ensure transition animation is complete

      return () => clearTimeout(timer);
    }
  }, [externalIsWelcomeScreen]);

  // File type selection handling
  // Handle file upload after file type selection
  const handleFileSelect = (files: FileList | null) => {
    if (files && files.length > 0) {
      const filesArray = Array.from(files);
      addFiles(filesArray); // Add to Store

      // For each file, initiate upload
      filesArray.forEach(file => {
        const fileId = `${file.name}-${file.lastModified}-${file.size}`;
        updateFileStatus(fileId, 'uploading'); // Immediately mark as uploading

        // Call upload service
        // Use current appId for upload, use default if not available
        const appIdToUse = currentAppId || 'chat-input-warning-no-app-id';
        const userIdToUse =
          session?.user?.id || 'chat-input-warning-no-user-id'; // Use anonymous user ID

        uploadDifyFile(appIdToUse, file, userIdToUse)
          .then(response => {
            // Upload successful
            updateFileUploadedId(fileId, response.id);
            console.log(
              `[ChatInput] File upload successful: ${fileId} -> ${response.id}`
            );
          })
          .catch(error => {
            // Upload failed
            updateFileStatus(
              fileId,
              'error',
              error.message || t('input.uploadFailed')
            );
            console.error(`[ChatInput] File upload failed: ${fileId}`, error);
          });
      });
    }
  };

  // --- Retry upload logic ---
  const handleRetryUpload = useCallback(
    async (fileId: string) => {
      console.log(`[ChatInput] Retrying upload for file ID: ${fileId}`);
      // Get file directly from store state
      const attachment = useAttachmentStore
        .getState()
        .files.find(f => f.id === fileId);

      if (!attachment) {
        console.error(
          `[ChatInput] Cannot retry: Attachment with ID ${fileId} not found.`
        );
        useNotificationStore
          .getState()
          .showNotification(
            `${t('input.retryUpload')}: ${t('input.fileUploadError')} ${fileId}`,
            'error'
          );
        return;
      }

      // 1. Reset status to uploading
      updateFileStatus(fileId, 'uploading');

      // 2. Re-call upload service
      try {
        // Use current appId for upload, use default if not available
        const appIdToUse = currentAppId || 'chat-input-warning-no-app-id';
        const userIdToUse =
          session?.user?.id || 'chat-input-warning-no-user-id'; // Use anonymous user ID

        const response = await uploadDifyFile(
          appIdToUse,
          attachment.file, // Use original File object
          userIdToUse
        );
        // Retry successful
        updateFileUploadedId(fileId, response.id);
        console.log(
          `[ChatInput] Retry upload successful: ${fileId} -> ${response.id}`
        );
      } catch (error) {
        // Retry failed, mark as error again
        updateFileStatus(
          fileId,
          'error',
          (error as Error).message || t('input.retryUpload')
        );
        console.error(`[ChatInput] Retry upload failed: ${fileId}`, error);
        useNotificationStore
          .getState()
          .showNotification(
            `${t('input.fileUploadError')} ${attachment.name}: ${(error as Error)?.message || t('input.unknownError')}`,
            'error'
          );
      }
    },
    [currentAppId, updateFileStatus, updateFileUploadedId, session?.user?.id, t]
  );

  // --- Calculate button disable status (depends on store) ---
  const isUploading = attachments.some(f => f.status === 'uploading');
  const hasError = attachments.some(f => f.status === 'error');

  // 🎯 Fix: Only show spinner when validating message submission
  // Validation during app switch does not affect input box state
  const isValidatingConfig = isValidatingForMessageOnly;

  // Use external welcome screen state first, if not available, use internal state
  // This ensures that the welcome screen display state can be controlled in the page component
  const effectiveIsWelcomeScreen = externalIsWelcomeScreen || isWelcomeScreen;

  // 🎯 Button fade-in animation control logic - simplified version, handling all animations uniformly
  useEffect(() => {
    // When first mounted, quickly display buttons
    if (isInitialMount) {
      const mountTimer = setTimeout(() => {
        setShowButtons(true);
        setIsInitialMount(false);
      }, 50);
      return () => clearTimeout(mountTimer);
    }

    // 🎯 Prevent animation interference during message submission
    if (isProcessing || isLocalSubmitting) {
      // During message submission, maintain current state, do not trigger animation
      return;
    }

    // Handle animation for state changes
    if (effectiveIsWelcomeScreen || isTransitioningToWelcome) {
      // When transitioning to welcome screen: hide first, then quickly show
      setShowButtons(false);
      const welcomeTimer = setTimeout(() => {
        setShowButtons(true);
      }, 80);
      return () => clearTimeout(welcomeTimer);
    } else {
      // When other state changes, immediately show
      setShowButtons(true);
    }
  }, [
    effectiveIsWelcomeScreen,
    isTransitioningToWelcome,
    isInitialMount,
    isProcessing,
    isLocalSubmitting,
  ]);

  return (
    <ChatContainer
      isWelcomeScreen={effectiveIsWelcomeScreen}
      className={className}
      widthClass={widthClass}
      isTransitioningToWelcome={isTransitioningToWelcome}
    >
      {/* Attachment preview bar, only show when there are attachments */}
      <AttachmentPreviewBar
        onHeightChange={handleAttachmentBarHeightChange}
        onRetryUpload={handleRetryUpload}
      />

      {/* Text area */}
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

      {/* Button area - 🎯 Add fade-in animation */}
      <div className="px-4">
        <ChatButtonArea>
          {/* 🎯 File attachment button - from center scale fade-in */}
          <div
            className={cn(
              'flex-none transition-all duration-250 ease-out',
              showButtons ? 'scale-100 opacity-100' : 'scale-80 opacity-0'
            )}
            style={{ transitionDelay: showButtons ? '0ms' : '0ms' }}
          >
            <FileTypeSelector
              onFileSelect={handleFileSelect}
              disabled={isUploading || isProcessing}
              ariaLabel={t('input.addAttachment')}
            />
          </div>

          {/* Middle area: App selector button, can extend left - 🎯 With layered scale fade-in animation */}
          <div className="flex flex-1 items-center justify-end space-x-2">
            {/* 🎯 Model selector button - from center scale fade-in */}
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

            {/* 🎯 Send button - from center scale fade-in */}
            <div
              className={cn(
                'transition-all duration-250 ease-out',
                showButtons ? 'scale-100 opacity-100' : 'scale-80 opacity-0'
              )}
              style={{ transitionDelay: showButtons ? '120ms' : '0ms' }}
            >
              <ChatButton
                icon={
                  isLocalSubmitting || isWaiting || isValidatingConfig ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : isProcessing ? (
                    <Square className="h-5 w-5" />
                  ) : (
                    <ArrowUpIcon className="h-5 w-5" />
                  )
                }
                variant="submit"
                onClick={
                  isLocalSubmitting || isWaiting || isValidatingConfig
                    ? undefined
                    : isProcessing
                      ? onStop
                      : handleLocalSubmit
                }
                disabled={
                  isLocalSubmitting || // 🎯 New: disable button during local submission
                  isWaiting ||
                  isValidatingConfig || // 🎯 New: disable button during validation
                  isUploading ||
                  hasError ||
                  (!isProcessing && !message.trim()) ||
                  !canSubmitWithModel
                }
                ariaLabel={
                  isLocalSubmitting
                    ? t('input.sending')
                    : isValidatingConfig
                      ? t('input.validatingConfig')
                      : isProcessing
                        ? t('input.stopGeneration')
                        : isUploading
                          ? t('input.uploading')
                          : hasError
                            ? t('input.uploadFailed')
                            : !canSubmitWithModel
                              ? requireModelValidation
                                ? !hasAvailableModels
                                  ? t('input.noModelAvailable')
                                  : t('input.pleaseSelectModel')
                                : t('input.cannotSubmit')
                              : t('input.sendMessage')
                }
                forceActiveStyle={
                  isLocalSubmitting || isWaiting || isValidatingConfig
                }
              />
            </div>
          </div>
        </ChatButtonArea>
      </div>
    </ChatContainer>
  );
};

// Export all sub-components for easy individual use
export { ChatButton } from './button';
export { ChatTextInput } from './text-input';
export { ChatButtonArea, ChatTextArea } from './layout';
export { ChatContainer } from './container';
export { AttachmentPreviewBar } from './attachment-preview-bar';
export { AttachmentPreviewItem } from './attachment-preview-item';
