'use client';

import { useMobile } from '@lib/hooks/use-mobile';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';

import { useState } from 'react';

import { SidebarContent } from './sidebar-content';
import { SidebarFooter } from './sidebar-footer';
import { SidebarHeader } from './sidebar-header';

export function SidebarContainer() {
  const { isExpanded, toggleSidebar, isAnimating, hideMobileNav } =
    useSidebarStore();
  const isMobile = useMobile();

  // Hover state management - for background effects only, does not trigger expansion
  const [isHovering, setIsHovering] = useState(false);

  // Disable hover events on mobile and ensure cursor state is reset correctly
  const handleMouseEnter = () => {
    if (!isMobile) {
      setIsHovering(true);
      const activeElement = document.activeElement as HTMLElement;
      activeElement?.blur?.();
    }
  };

  const handleMouseLeave = () => {
    if (!isMobile) {
      setIsHovering(false);
      const activeElement = document.activeElement as HTMLElement;
      activeElement?.blur?.();
    }
  };

  // Combined click handler for the entire sidebar
  const handleContainerClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;

    // Mobile-specific logic: close sidebar on nav button click
    if (isMobile) {
      if (target.closest('[data-nav-button="true"]')) {
        hideMobileNav();
      }
      // On mobile, we don't want the desktop expand/collapse logic, so we stop here.
      return;
    }

    // Desktop-specific logic: expand sidebar on clicking non-interactive areas
    if (
      target.closest('button') ||
      target.closest('[role="button"]') ||
      target.closest('input') ||
      target.closest('textarea') ||
      target.closest('[data-dropdown-trigger]') ||
      target.closest('[data-more-button]')
    ) {
      return;
    }

    if (!isExpanded) {
      toggleSidebar();
    }
  };

  return (
    <aside
      className={cn(
        'fixed top-0 left-0 flex h-full flex-col border-r',
        isMobile
          ? 'transition-transform duration-150 ease-in-out'
          : 'transition-[width,background-color] duration-150 ease-in-out',

        isExpanded ? 'w-64' : 'w-16',

        isMobile && !isExpanded && '-translate-x-full',
        isMobile && isExpanded && 'translate-x-0',

        !isMobile && 'translate-x-0',

        isMobile ? 'z-50' : 'z-30',

        isExpanded
          ? 'bg-stone-200 dark:bg-stone-700'
          : 'bg-stone-100 dark:bg-stone-800',
        'border-r-stone-300/60 dark:border-r-stone-700/50',
        'text-stone-700 dark:text-stone-300',
        !isExpanded &&
          !isMobile &&
          'hover:bg-stone-300 dark:hover:bg-stone-600',
        'select-none',
        (!isExpanded && !isMobile) || (isAnimating && !isMobile)
          ? 'cursor-e-resize'
          : ''
      )}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={handleContainerClick}
    >
      <div className="flex h-full flex-col">
        <SidebarHeader isHovering={isHovering} />
        <SidebarContent />
        <SidebarFooter />
      </div>
    </aside>
  );
}
