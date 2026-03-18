'use client';

import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';

import React, { useEffect, useState } from 'react';

import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';

interface ClientLayoutProps {
  children: React.ReactNode;
}

const LayoutSmartShortcuts = dynamic(
  () =>
    import('./layout-smart-shortcuts').then(
      module => module.LayoutSmartShortcuts
    ),
  { ssr: false }
);

/**
 * Client layout component
 * Responsible for applying appropriate CSS classes based on the current path
 * Chat page uses fixed height and overflow scrolling, other pages use natural height
 */
export function ClientLayout({ children }: ClientLayoutProps) {
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();
  const isChatPage = pathname?.startsWith('/chat');

  useEffect(() => {
    setMounted(true);

    // 🎯 Global setting sidebar mount state to avoid flickering caused by repeated calls to each layout
    const { setMounted: setSidebarMounted } = useSidebarStore.getState();
    setSidebarMounted();
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

  const layoutClass = cn(
    'antialiased',
    mounted ? (isChatPage ? 'h-full' : 'min-h-screen') : ''
  );

  return (
    <div className={layoutClass}>
      {mounted ? <LayoutSmartShortcuts /> : null}
      {children}
    </div>
  );
}
