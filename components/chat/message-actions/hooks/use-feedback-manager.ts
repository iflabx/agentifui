'use client';

import { useCallback, useState } from 'react';

/**
 * Hook to manage feedback button state with exclusive selection.
 *
 * @param onFeedback Callback function to be called when feedback is given.
 * @returns Feedback state and handler functions.
 */
export function useFeedbackManager(onFeedback?: (isPositive: boolean) => void) {
  // The current selected feedback type: null (not selected), true (thumbs up), false (thumbs down)
  const [selectedFeedback, setSelectedFeedback] = useState<boolean | null>(
    null
  );

  // Handler for feedback action
  const handleFeedback = useCallback(
    (isPositive: boolean) => {
      if (typeof onFeedback === 'function') {
        // Call the external callback
        onFeedback(isPositive);
        // Set the current selection
        setSelectedFeedback(isPositive);
      }
    },
    [onFeedback]
  );

  return {
    // The current selected feedback type
    selectedFeedback,
    // Handler for feedback action
    handleFeedback,
    // Determines whether the button should be shown
    shouldShowButton: (isPositive: boolean) =>
      selectedFeedback === null || selectedFeedback === isPositive,
  };
}
