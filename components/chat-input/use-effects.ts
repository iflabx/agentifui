import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useChatScrollStore } from '@lib/stores/chat-scroll-store';

import { useEffect, useState } from 'react';

import { useFocusManager } from './focus-manager';

export function useChatInputWaitingEffect(input: {
  clearAttachments: () => void;
  clearMessage: () => void;
  isWaiting: boolean;
  setIsLocalSubmitting: (value: boolean) => void;
}) {
  const [previousIsWaiting, setPreviousIsWaiting] = useState(input.isWaiting);

  useEffect(() => {
    if (input.isWaiting && !previousIsWaiting) {
      input.clearMessage();
      input.clearAttachments();
      useChatScrollStore.getState().scrollToBottom('smooth');
      input.setIsLocalSubmitting(false);
    }

    setPreviousIsWaiting(input.isWaiting);
  }, [
    input.clearAttachments,
    input.clearMessage,
    input.isWaiting,
    input.setIsLocalSubmitting,
    previousIsWaiting,
  ]);
}

export function useChatInputFocusEffects(input: {
  externalIsWelcomeScreen: boolean;
  isProcessing: boolean;
  isWaitingForResponse: boolean;
  isWelcomeScreen: boolean;
  message: string;
}) {
  useEffect(() => {
    const currentIsComposing = useChatInputStore.getState().isComposing;
    if (
      input.message &&
      !input.isProcessing &&
      !input.isWaitingForResponse &&
      !currentIsComposing
    ) {
      useFocusManager.getState().focusInput();
    }
  }, [input.isProcessing, input.isWaitingForResponse, input.message]);

  useEffect(() => {
    useFocusManager.getState().focusInput();
  }, []);

  useEffect(() => {
    if (input.isWelcomeScreen) {
      const timer = setTimeout(() => {
        useFocusManager.getState().focusInput();
      }, 150);

      return () => clearTimeout(timer);
    }
  }, [input.isWelcomeScreen]);

  useEffect(() => {
    if (input.externalIsWelcomeScreen) {
      const timer = setTimeout(() => {
        useFocusManager.getState().focusInput();
      }, 150);

      return () => clearTimeout(timer);
    }
  }, [input.externalIsWelcomeScreen]);
}

export function useChatInputButtonVisibility(input: {
  effectiveIsWelcomeScreen: boolean;
  isLocalSubmitting: boolean;
  isProcessing: boolean;
  isTransitioningToWelcome: boolean;
}) {
  const [showButtons, setShowButtons] = useState(false);
  const [isInitialMount, setIsInitialMount] = useState(true);

  useEffect(() => {
    if (isInitialMount) {
      const mountTimer = setTimeout(() => {
        setShowButtons(true);
        setIsInitialMount(false);
      }, 50);
      return () => clearTimeout(mountTimer);
    }

    if (input.isProcessing || input.isLocalSubmitting) {
      return;
    }

    if (input.effectiveIsWelcomeScreen || input.isTransitioningToWelcome) {
      setShowButtons(false);
      const welcomeTimer = setTimeout(() => {
        setShowButtons(true);
      }, 80);
      return () => clearTimeout(welcomeTimer);
    }

    setShowButtons(true);
  }, [
    input.effectiveIsWelcomeScreen,
    input.isLocalSubmitting,
    input.isProcessing,
    input.isTransitioningToWelcome,
    isInitialMount,
  ]);

  return showButtons;
}
