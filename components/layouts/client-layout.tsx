'use client';

import { useSmartShortcuts } from '@lib/hooks/use-smart-shortcuts';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';

import React, { useEffect, useState } from 'react';

import { usePathname } from 'next/navigation';

interface ClientLayoutProps {
  children: React.ReactNode;
  fontClasses: string;
}

/**
 * Client layout component
 * Responsible for applying appropriate CSS classes based on the current path
 * Chat page uses fixed height and overflow scrolling, other pages use natural height
 */
export function ClientLayout({ children, fontClasses }: ClientLayoutProps) {
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const isChatPage = pathname?.startsWith('/chat');

  // 🎯 Enable smart shortcuts: navigation shortcuts are also available in input fields
  // Cmd+K new conversation, Cmd+Shift+A application market, Cmd+\ switch sidebar
  useSmartShortcuts({
    enabled: mounted, // Only enable after client mount
  });

  useEffect(() => {
    setMounted(true);
    // After the client component is mounted, add the render-ready class to the body, making it visible
    document.body.classList.add('render-ready');

    // 🎯 Global setting sidebar mount state to avoid flickering caused by repeated calls to each layout
    const { setMounted: setSidebarMounted } = useSidebarStore.getState();
    setSidebarMounted();

    // Cleanup function: only remove render-ready when ClientLayout itself is unmounted
    return () => {
      document.body.classList.remove('render-ready');
    };
  }, []); // Empty dependency array, ensure this effect runs only once on mount and unmount

  useEffect(() => {
    if (!mounted) return;
    const bodyElement = document.body;
    if (isChatPage) {
      bodyElement.classList.add('chat-page');
      bodyElement.classList.remove('default-page');
    } else {
      bodyElement.classList.add('default-page');
      bodyElement.classList.remove('chat-page');
    }
    // Cleanup function: only clean up page-specific classes
    return () => {
      bodyElement.classList.remove('chat-page', 'default-page');
    };
  }, [pathname, isChatPage, mounted]); // Dependencies remain unchanged, used for switching page-specific classes

  const layoutClass = mounted
    ? cn(fontClasses, 'antialiased', isChatPage ? 'h-full' : 'min-h-screen')
    : cn(fontClasses, 'antialiased');

  return <div className={layoutClass}>{children}</div>;
}
