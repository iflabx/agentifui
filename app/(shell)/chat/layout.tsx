'use client';

import { MobileNavButton } from '@components/mobile';
import { useMobile } from '@lib/hooks';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';

interface ChatLayoutProps {
  children: React.ReactNode;
}

export default function ChatLayout({ children }: ChatLayoutProps) {
  const { isExpanded, isMounted } = useSidebarStore();
  const isMobile = useMobile();

  // Remove duplicate setMounted calls, now managed by global ClientLayout
  // Calculate the left margin of the main content area
  // Set the margin based on the sidebar expansion state, push the main content
  const getMainMarginLeft = () => {
    if (isMobile) return 'ml-0';
    return isExpanded ? 'ml-64' : 'ml-16';
  };

  return (
    <div
      className={cn(
        'flex h-full min-h-screen',
        'bg-stone-100 dark:bg-stone-800'
      )}
    >
      {/* 
        Mobile navigation button - only show after client mount
      */}
      <div className="fixed top-4 left-4 z-50 md:hidden">
        {isMounted && <MobileNavButton />}
      </div>

      {/* Main content area - ensure chat page has fixed height and correct scrolling behavior */}
      <main
        className={cn(
          'h-screen w-full overflow-auto', // Use w-full instead of flex-1
          getMainMarginLeft(),
          // Transition effect
          'transition-[margin-left] duration-150 ease-in-out'
        )}
      >
        <div className="h-full p-0">{children}</div>
      </main>
    </div>
  );
}
