'use client';

import { useMobile } from '@lib/hooks/use-mobile';
import { useSettingsColors } from '@lib/hooks/use-settings-colors';
import { useThemeColors } from '@lib/hooks/use-theme-colors';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';

import React from 'react';

import { usePathname } from 'next/navigation';

import { ConversationTitleButton } from './conversation-title-button';
import { DesktopUserAvatar } from './desktop-user-avatar';
import { WorkflowHistoryButton } from './workflow-history-button';

/**
 * Desktop top navigation bar component
 * Features:
 * - Only displayed in desktop view (md and above)
 * - Use stone color palette, consistent with application overall style
 * - Display user avatar button in the upper right corner, click to pop up dropdown menu
 * - Display current conversation title button on the left (only on historical conversation page)
 * - Layout adjusts left margin dynamically based on the expanded/collapsed state of the sidebar
 * - Automatically adapt to the background color of the settings page on the settings page, achieve seamless integration effect
 */
export function NavBar() {
  const isMobile = useMobile();
  const pathname = usePathname() ?? '';
  const { colors: themeColors } = useThemeColors();
  const { colors: settingsColors } = useSettingsColors();
  const { isExpanded } = useSidebarStore();

  if (isMobile) {
    return null;
  }

  // 🎯 Select appropriate background color based on current page path
  // Settings page uses settings-specific background color, other pages use theme background color
  // Ensure navbar is fully integrated with the page, no sense of incongruity
  const isSettingsPage = pathname?.startsWith('/settings');
  const backgroundColor = isSettingsPage
    ? settingsColors.pageBackground.tailwind
    : themeColors.mainBackground.tailwind;

  // Calculate left margin: desktop always leaves space for sidebar
  // Set corresponding margin based on expansion state
  const getLeftMargin = () => {
    return isExpanded ? 'left-0 md:left-64' : 'left-0 md:left-16';
  };

  return (
    <>
      {/* Header main */}
      <header
        className={cn(
          'fixed top-0 right-4 z-20 h-12',
          getLeftMargin(),
          'transition-[left] duration-150 ease-in-out',
          backgroundColor,
          'flex items-center justify-between pr-2 pl-4'
        )}
      >
        <div className="flex items-center space-x-2">
          {/* Left side: current conversation title button, supports dynamic hiding strategy, only shows on history chat page */}
          <ConversationTitleButton />
        </div>

        <div className="flex items-center space-x-2">
          {/* Workflow history button (only shows on workflow and text generation pages) */}
          <WorkflowHistoryButton />

          {/* User avatar button */}
          <DesktopUserAvatar />
        </div>
      </header>
    </>
  );
}
