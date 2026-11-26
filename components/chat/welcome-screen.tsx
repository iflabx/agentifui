'use client';

import { TypeWriter } from '@components/ui/typewriter';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import { useDateFormatter } from '@lib/hooks/use-date-formatter';
import { useTypewriterStore } from '@lib/stores/ui/typewriter-store';
import { cn } from '@lib/utils';

import React, { useEffect, useMemo, useState } from 'react';

interface WelcomeScreenProps {
  className?: string;
  username?: string | null;
}

export const WelcomeScreen = ({ className, username }: WelcomeScreenProps) => {
  // Use unified time-based greeting hook to replace duplicated greeting logic
  const { getTimeBasedGreeting } = useDateFormatter();
  const [finalText, setFinalText] = useState('');
  // TypeWriter reset key, ensures re-typing when switching apps
  const [typewriterKey, setTypewriterKey] = useState(0);

  // Typewriter state management
  const { setWelcomeTypewriterComplete, resetWelcomeTypewriter } =
    useTypewriterStore();

  // Dynamic typewriter speed config
  // Adjust typing speed based on text length for better UX
  const typewriterConfig = useMemo(() => {
    const textLength = finalText.length;

    // Smart speed threshold config:
    // Short text: slow for ceremonial feel
    // Medium: moderate speed
    // Long: fast to avoid long waits
    // Extra long: ultra fast
    if (textLength <= 20) {
      // Short text (≤20 chars): slow
      return {
        speed: 20,
        delay: 50,
        description: 'short-slow',
      };
    } else if (textLength <= 50) {
      // Medium-short (21-50 chars): standard
      return {
        speed: 15,
        delay: 40,
        description: 'medium-short-standard',
      };
    } else if (textLength <= 100) {
      // Medium (51-100 chars): moderate
      return {
        speed: 10,
        delay: 30,
        description: 'medium-moderate',
      };
    } else if (textLength <= 200) {
      // Long (101-200 chars): fast
      return {
        speed: 5,
        delay: 10,
        description: 'long-fast',
      };
    } else {
      // Extra long (>200 chars): ultra fast
      return {
        speed: 8,
        delay: 100,
        description: 'extra-long-ultrafast',
      };
    }
  }, [finalText.length]);

  // Get opening statement config directly from current app instance
  // No API call, only DB
  // Add validation state protection to avoid showing wrong content during app switching
  const { currentAppInstance, isValidating, isLoading } = useCurrentApp();

  // Remove complex app switching detection logic, simplify component responsibility
  // Welcome text display should not depend on complex path matching or app state
  // Priority: DB opening statement > username greeting > default time greeting
  // Add blocking wait to avoid rendering wrong welcome text during app switching
  useEffect(() => {
    console.log('[WelcomeScreen] Current state:', {
      username,
      hasOpeningStatement:
        !!currentAppInstance?.config?.dify_parameters?.opening_statement,
      currentAppId: currentAppInstance?.instance_id,
      pathname: window.location.pathname,
      isValidating,
      isLoading,
    });

    // Add app state check to avoid showing wrong content during app switching
    // This is the key blocking point to prevent repeated rendering
    if (isValidating || isLoading) {
      console.log(
        '[WelcomeScreen] App is validating or loading, pause updating welcome text',
        {
          isValidating,
          isLoading,
        }
      );
      return;
    }

    // As long as username is not undefined, show welcome text
    // Even if username is null, show default greeting
    if (username === undefined) {
      console.log('[WelcomeScreen] Waiting for user info to load...');
      return;
    }

    // Add delay to ensure app data is stable before rendering
    // Avoid rendering wrong content during intermediate app switching state
    const updateTimer = setTimeout(() => {
      // Reset typewriter state, prepare for new typing animation
      resetWelcomeTypewriter();

      // Determine final text to display - simplified version
      let welcomeText = '';

      // Get opening statement from DB config field (if any)
      const openingStatement =
        currentAppInstance?.config?.dify_parameters?.opening_statement;

      if (openingStatement && openingStatement.trim()) {
        // Case 1: App has opening statement config in DB
        welcomeText = openingStatement.trim();
        console.log('[WelcomeScreen] Using DB opening statement:', {
          appId: currentAppInstance?.instance_id,
          text: welcomeText.substring(0, 50) + '...',
        });
      } else if (username) {
        // Case 2: No opening statement but has username -> personalized time greeting
        welcomeText = getTimeBasedGreeting({ includeUsername: true, username });
        console.log('[WelcomeScreen] Using username greeting:', welcomeText);
      } else {
        // Case 3: No username -> default time greeting
        welcomeText = getTimeBasedGreeting();
        console.log('[WelcomeScreen] Using default greeting:', welcomeText);
      }

      // Set text and force restart typewriter animation
      setFinalText(welcomeText);
      setTypewriterKey(prev => prev + 1);

      console.log('[WelcomeScreen] Welcome text updated:', welcomeText);
    }, 200); // Increased to 200ms to ensure app data is stable

    // Cleanup timer
    return () => clearTimeout(updateTimer);
  }, [
    username,
    currentAppInstance?.config?.dify_parameters?.opening_statement,
    currentAppInstance?.instance_id,
    isValidating, // Listen to validation state
    isLoading, // Listen to loading state
    resetWelcomeTypewriter,
    getTimeBasedGreeting,
  ]);

  // Typewriter complete callback
  const handleTypewriterComplete = () => {
    console.log(
      '[WelcomeScreen] Typewriter animation complete, notify suggested questions component to render'
    );
    setWelcomeTypewriterComplete(true);
  };

  return (
    <div className={cn('welcome-screen mb-4 px-4 text-center', className)}>
      <div className="w-full">
        {/* Main title container: uses highest priority width settings provided by Hook */}
        <h2 className="text-xl leading-tight font-bold break-words sm:text-2xl">
          {/* Optimized: Intelligent typewriter effect with dynamic speed adjustment based on text length */}
          {/* Short text: slow typing for ceremonial feel; Long text: fast typing to avoid waiting */}
          {/* Added key property to restart typewriter animation on app switch */}
          {/* Added onComplete callback to notify suggested questions component to start rendering */}
          <TypeWriter
            key={typewriterKey} // Force restart typewriter animation
            text={finalText}
            speed={typewriterConfig.speed} // Dynamic speed
            delay={typewriterConfig.delay} // Dynamic delay
            waitingEffect={finalText.endsWith('...')}
            onComplete={handleTypewriterComplete} // Typewriter complete callback
          />
        </h2>
      </div>
    </div>
  );
};
