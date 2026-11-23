'use client';

import { useWelcomeLayout } from '@lib/hooks/use-welcome-layout';
import { cn } from '@lib/utils';

// Container component - uses intelligent layout system
interface ChatContainerProps {
  children: React.ReactNode;
  beforeInput?: React.ReactNode;
  afterInput?: React.ReactNode;
  isWelcomeScreen?: boolean;
  className?: string;
  widthClass: string;
  embedded?: boolean;
  // Whether transitioning from conversation interface to welcome interface
  // When true, use flashing effect instead of sliding
  // When false, keep existing sliding effect
  isTransitioningToWelcome?: boolean;
}

// Define the distance from the conversation interface to the bottom
const INPUT_BOTTOM_MARGIN = '1rem';

export const ChatContainer = ({
  children,
  beforeInput,
  afterInput,
  isWelcomeScreen = false,
  className,
  widthClass,
  embedded = false,
  isTransitioningToWelcome = false, // eslint-disable-line @typescript-eslint/no-unused-vars
}: ChatContainerProps) => {
  const { input: inputPosition } = useWelcomeLayout();

  // Base styles including absolute positioning and width
  // Simplified transition effects using opacity instead of sliding
  const baseClasses = cn(
    embedded ? 'relative mx-auto w-full' : 'absolute left-1/2 w-full',
    widthClass,
    // Use flashing transition effect, only transition opacity
    'transition-opacity duration-100 ease-in-out',
    className
  );

  // Dynamic calculation of styles, based on current state to determine position and deformation
  // Welcome screen uses intelligent layout system, conversation interface maintains original logic
  const dynamicStyles: React.CSSProperties = isWelcomeScreen
    ? {
        // Welcome screen: use intelligent layout system calculated position
        top: inputPosition.top,
        bottom: 'auto', // Ensure bottom is invalid
        transform: inputPosition.transform,
        // Use flashing effect uniformly
        transition: 'opacity 100ms ease-in-out',
      }
    : {
        // Conversation interface: based on bottom positioning, and horizontally centered through transform
        top: 'auto', // Ensure top is invalid
        bottom: INPUT_BOTTOM_MARGIN,
        transform: 'translateX(-50%)',
        // Use flashing effect uniformly
        transition: 'opacity 100ms ease-in-out',
      };

  return (
    <div
      data-chat-input-container
      className={baseClasses}
      style={embedded ? undefined : dynamicStyles}
    >
      {beforeInput}
      <div
        className={cn(
          'flex flex-col rounded-2xl',
          'bg-white dark:bg-stone-700',
          'shadow-[0_0_15px_rgba(0,0,0,0.1)]'
        )}
      >
        {children}
      </div>
      {afterInput}
    </div>
  );
};
