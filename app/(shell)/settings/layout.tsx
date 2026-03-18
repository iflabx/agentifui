'use client';

import { MobileNavButton } from '@components/mobile';
import { SettingsMobileNav, SettingsSidebar } from '@components/settings';
import { useMobile } from '@lib/hooks';
import { useSettingsColors } from '@lib/hooks/use-settings-colors';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';

interface SettingsLayoutProps {
  children: React.ReactNode;
}

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  const { isExpanded, isMounted } = useSidebarStore();
  const isMobile = useMobile();
  const { colors } = useSettingsColors();

  // Remove duplicate setMounted calls, now managed by global ClientLayout
  // Calculate the left margin of the main content area
  // Set the margin based on the sidebar expansion state, push the main content
  const getMainMarginLeft = () => {
    if (isMobile) return 'ml-0';
    return isExpanded ? 'ml-64' : 'ml-16';
  };

  return (
    <div
      className={cn('flex h-full min-h-screen', colors.pageBackground.tailwind)}
    >
      <div className="fixed top-4 left-4 z-50 md:hidden">
        {isMounted && <MobileNavButton />}
      </div>

      {/* Main content area - divided into left settings navigation and right content */}
      <main
        className={cn(
          'h-screen w-full overflow-auto',
          getMainMarginLeft(),
          'transition-[margin-left] duration-150 ease-in-out',
          colors.textColor.tailwind,
          'pt-12'
        )}
      >
        <div className="flex h-full flex-col md:flex-row">
          {/* Settings sidebar - mobile responsive hidden, remove divider to keep simple */}
          <div
            className={cn(
              'relative z-40 hidden w-64 shrink-0 md:block',
              colors.pageBackground.tailwind
            )}
          >
            <SettingsSidebar />
          </div>

          {/* Mobile settings navigation - only show on mobile */}
          <div
            className={cn(
              'block p-4 md:hidden',
              colors.pageBackground.tailwind
            )}
          >
            <SettingsMobileNav />
          </div>

          {/* Settings content area */}
          <div className="flex-1 overflow-auto">
            {/* Settings page content */}
            <div className="p-4 md:p-8">{children}</div>
          </div>
        </div>
      </main>
    </div>
  );
}
