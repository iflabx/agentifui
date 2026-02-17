'use client';

import { SuggestedQuestionButton } from '@components/ui/suggested-question-button';
import { useChatWidth } from '@lib/hooks';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import { useWelcomeLayout } from '@lib/hooks/use-welcome-layout';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useTypewriterStore } from '@lib/stores/ui/typewriter-store';
import { cn } from '@lib/utils';

import React, { useEffect, useMemo, useState } from 'react';

import { useTranslations } from 'next-intl';

interface DynamicSuggestedQuestionsProps {
  className?: string;
  onQuestionClick?: (messageText: string, files?: unknown[]) => Promise<void>;
}

/**
 * Dynamic suggested questions component.
 * Fetches suggested questions from database config and displays them progressively.
 * Only renders after the welcome typewriter animation is complete.
 */
export const DynamicSuggestedQuestions = ({
  className,
  onQuestionClick,
}: DynamicSuggestedQuestionsProps) => {
  const { widthClass, paddingClass } = useChatWidth();
  const { currentAppInstance, isValidating, isLoading } = useCurrentApp();
  const { setMessage } = useChatInputStore();
  const t = useTranslations('pages.chat.suggestedQuestions');

  // Listen for typewriter completion status
  const { isWelcomeTypewriterComplete } = useTypewriterStore();

  // Get suggested questions position and layout info from smart layout system
  const { suggestedQuestions: questionsPosition, needsCompactLayout } =
    useWelcomeLayout();

  // App switching state, consistent with welcome-screen logic
  const [isAppSwitching, setIsAppSwitching] = useState(false);
  const [displayQuestions, setDisplayQuestions] = useState<string[]>([]);
  const [shouldShowQuestions, setShouldShowQuestions] = useState(false);

  // Detect app switching, logic matches welcome-screen
  useEffect(() => {
    const pathname = window.location.pathname;
    const isOnAppDetailPage =
      pathname.startsWith('/apps/') && pathname.split('/').length === 4;
    const isOnNewChatPage = pathname === '/chat/new';

    if (isOnAppDetailPage) {
      const urlInstanceId = pathname.split('/')[3];
      const currentInstanceId = currentAppInstance?.instance_id;

      const isUrlAppMismatch =
        currentInstanceId && currentInstanceId !== urlInstanceId;
      const isLoadingWithTargetApp =
        (isValidating || isLoading) && urlInstanceId;
      const isNoAppButHasTarget = !currentInstanceId && urlInstanceId;

      if (isUrlAppMismatch || isLoadingWithTargetApp || isNoAppButHasTarget) {
        setIsAppSwitching(true);
      } else if (
        currentInstanceId === urlInstanceId &&
        !isValidating &&
        !isLoading
      ) {
        setIsAppSwitching(false);
      }
    } else if (isOnNewChatPage) {
      const appMetadata = currentAppInstance?.config?.app_metadata;
      const isModelApp = appMetadata?.app_type === 'model';

      if (currentAppInstance && !isModelApp) {
        setIsAppSwitching(true);
      } else if (isModelApp && !isValidating && !isLoading) {
        setIsAppSwitching(false);
      }
    } else {
      setIsAppSwitching(false);
    }
  }, [
    currentAppInstance?.instance_id,
    currentAppInstance?.config?.app_metadata,
    isValidating,
    isLoading,
  ]);

  // Fetch suggested questions, only after typewriter is complete
  useEffect(() => {
    // Must wait for typewriter to finish
    if (!isWelcomeTypewriterComplete) {
      setShouldShowQuestions(false);
      return;
    }

    // Do not update suggested questions during validation/loading/app switching
    if (isValidating || isLoading || isAppSwitching) {
      setShouldShowQuestions(false);
      return;
    }

    // Check app instance integrity
    if (!currentAppInstance?.instance_id) {
      setShouldShowQuestions(false);
      return;
    }

    // Check path consistency
    const pathname = window.location.pathname;
    const isOnAppDetailPage =
      pathname.startsWith('/apps/') && pathname.split('/').length === 4;

    if (isOnAppDetailPage) {
      const urlInstanceId = pathname.split('/')[3];
      if (currentAppInstance.instance_id !== urlInstanceId) {
        setShouldShowQuestions(false);
        return;
      }
    }

    // Delay rendering suggested questions for 300ms after typewriter completes
    const updateTimer = setTimeout(() => {
      // Get suggested questions from config
      const suggestedQuestions =
        currentAppInstance?.config?.dify_parameters?.suggested_questions;

      if (
        suggestedQuestions &&
        Array.isArray(suggestedQuestions) &&
        suggestedQuestions.length > 0
      ) {
        // Filter out empty strings and invalid questions
        const validQuestions = suggestedQuestions
          .filter(q => q && typeof q === 'string' && q.trim().length > 0)
          .map(q => q.trim());

        if (validQuestions.length > 0) {
          setDisplayQuestions(validQuestions);
          setShouldShowQuestions(true);
        } else {
          setDisplayQuestions([]);
          setShouldShowQuestions(false);
        }
      } else {
        setDisplayQuestions([]);
        setShouldShowQuestions(false);
      }
    }, 300); // Wait 300ms after typewriter completes

    return () => clearTimeout(updateTimer);
  }, [
    isWelcomeTypewriterComplete, // Core dependency: typewriter completion status
    currentAppInstance?.config?.dify_parameters?.suggested_questions,
    currentAppInstance?.instance_id,
    isValidating,
    isLoading,
    isAppSwitching,
  ]);

  // Smart layout calculation: dynamically adjust layout based on question count
  // Use flexbox layout to center buttons based on content width
  const layoutConfig = useMemo(() => {
    const count = displayQuestions.length;

    if (count === 0) return null;

    // Use flexbox layout, support auto width and center alignment
    // Show up to 6 questions
    return {
      maxDisplay: count > 6 ? 6 : count,
      description: `${count} questions - flexbox centered`,
    };
  }, [displayQuestions.length]);

  // Handle question click - send message directly
  const handleQuestionClick = async (question: string) => {
    if (onQuestionClick) {
      // Directly send message, equivalent to entering in input and clicking send
      try {
        await onQuestionClick(question);
      } catch (error) {
        console.error(`[DynamicSuggestedQuestions] Send message failed`, error);
        // If sending fails, fallback to setting input box content
        setMessage(question);
      }
    } else {
      // Fallback: just set input box content
      setMessage(question);
    }
  };

  // Do not render if there are no questions or should not show
  if (!shouldShowQuestions || !layoutConfig || displayQuestions.length === 0) {
    return null;
  }

  // Limit the number of displayed questions
  const questionsToShow = displayQuestions.slice(0, layoutConfig.maxDisplay);

  return (
    <div
      className={cn(
        'mx-auto w-full',
        widthClass,
        paddingClass,
        'absolute left-1/2',
        className
      )}
      style={questionsPosition}
    >
      {/* Question container: uses flexbox layout, supports multi-line wrapping with center alignment on each line */}
      <div className="flex flex-wrap items-start justify-center gap-3">
        {questionsToShow.map((question, index) => (
          <SuggestedQuestionButton
            key={`${currentAppInstance?.instance_id}-${index}`}
            question={question}
            onClick={handleQuestionClick}
            animationDelay={index * 100} // Each question appears with 100ms delay
            className={cn(needsCompactLayout && 'px-4 py-2 text-xs')}
          />
        ))}
      </div>

      {/* Show hint if there are more questions */}
      {displayQuestions.length > layoutConfig.maxDisplay && (
        <div
          className={cn(
            'animate-fade-in mt-3 text-center opacity-0',
            'font-serif text-xs text-stone-500'
          )}
          style={{
            animationDelay: `${questionsToShow.length * 100 + 200}ms`,
            animationFillMode: 'forwards',
          }}
        >
          {t('moreQuestions', {
            count: displayQuestions.length - layoutConfig.maxDisplay,
          })}
        </div>
      )}
    </div>
  );
};
