'use client';

import { ReturnToChatButton } from '@components/admin/return-to-chat-button';
import { LanguageSwitcher } from '@components/ui/language-switcher';
import { cn } from '@lib/utils';
import {
  Bell,
  Bug,
  Building2,
  ChevronRight,
  Key,
  KeyRound,
  ShieldCheck,
  Users,
  Wrench,
} from 'lucide-react';

import React, { ReactNode, useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

interface AdminLayoutProps {
  children: ReactNode;
}

interface MenuItem {
  text: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  description?: string;
}

export default function AdminLayout({ children }: AdminLayoutProps) {
  const pathname = usePathname() ?? '';
  const t = useTranslations('pages.admin.layout');

  const [isExpanded, setIsExpanded] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [contentVisible, setContentVisible] = useState(false);
  const [hoverTimeoutId, setHoverTimeoutId] = useState<number | null>(null);
  const [isMounted, setIsMounted] = useState(false);
  const [navigatingTo, setNavigatingTo] = useState<string | null>(null);

  const menuItems: MenuItem[] = [
    {
      text: t('menuItems.main.text'),
      icon: Wrench,
      href: '/admin',
      description: t('menuItems.main.description'),
    },
    {
      text: t('menuItems.apiConfig.text'),
      icon: Key,
      href: '/admin/api-config',
      description: t('menuItems.apiConfig.description'),
    },
    {
      text: t('menuItems.content.text'),
      icon: Bell,
      href: '/admin/content',
      description: t('menuItems.content.description'),
    },
    {
      text: t('menuItems.users.text'),
      icon: Users,
      href: '/admin/users',
      description: t('menuItems.users.description'),
    },
    {
      text: t('menuItems.ssoProviders.text'),
      icon: KeyRound,
      href: '/admin/sso-providers',
      description: t('menuItems.ssoProviders.description'),
    },
    {
      text: t('menuItems.groups.text'),
      icon: Building2,
      href: '/admin/groups',
      description: t('menuItems.groups.description'),
    },
    {
      text: t('menuItems.permissions.text'),
      icon: ShieldCheck,
      href: '/admin/permissions',
      description: t('menuItems.permissions.description'),
    },
    {
      text: t('menuItems.errors.text'),
      icon: Bug,
      href: '/admin/errors',
      description: t('menuItems.errors.description'),
    },
  ];

  const getBreadcrumbs = () => {
    const currentItem = menuItems.find(item => pathname.startsWith(item.href));
    return [
      { text: t('breadcrumbRoot'), href: '/admin' },
      ...(currentItem && currentItem.href !== '/admin'
        ? [{ text: currentItem.text, href: currentItem.href }]
        : []),
    ];
  };

  useEffect(() => {
    setIsMounted(true);
  }, []);

  useEffect(() => {
    if (!isExpanded) {
      setContentVisible(false);
      return;
    }

    const timer = setTimeout(() => {
      setContentVisible(true);
    }, 20);

    return () => clearTimeout(timer);
  }, [isExpanded]);

  const handleSetHovering = (hovering: boolean) => {
    if (typeof window !== 'undefined' && window.innerWidth < 768) {
      return;
    }

    if (hoverTimeoutId) {
      clearTimeout(hoverTimeoutId);
      setHoverTimeoutId(null);
    }

    if (hovering && !isExpanded) {
      setIsHovering(true);
      setIsExpanded(true);
      return;
    }

    if (!hovering && isHovering) {
      const timeoutId = window.setTimeout(() => {
        setIsHovering(false);
        setIsExpanded(false);
        setContentVisible(false);
      }, 100);
      setHoverTimeoutId(timeoutId);
      return;
    }

    setIsHovering(hovering);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutId) {
        clearTimeout(hoverTimeoutId);
      }
    };
  }, [hoverTimeoutId]);

  const handleMenuClick = (href: string) => {
    setNavigatingTo(href);
  };

  useEffect(() => {
    if (navigatingTo && pathname === navigatingTo) {
      setNavigatingTo(null);
    }
  }, [pathname, navigatingTo]);

  return (
    <div className="relative min-h-screen bg-stone-100 font-serif dark:bg-stone-800">
      <header className="fixed top-0 right-0 left-0 z-50 border-b border-b-stone-300/60 bg-stone-200 backdrop-blur-md dark:border-b-stone-700/50 dark:bg-stone-700">
        <div className="flex items-center justify-between px-6 py-2">
          <div className="flex items-center gap-4">
            <h1 className="text-base font-semibold text-stone-900 dark:text-gray-100">
              {t('headerTitle')}
            </h1>
            {getBreadcrumbs().length > 1 && (
              <nav className="ml-4">
                <ol className="flex items-center space-x-2 text-sm">
                  {getBreadcrumbs().map((crumb, index) => (
                    <li key={crumb.href} className="flex items-center">
                      {index > 0 && (
                        <ChevronRight className="mx-2 h-3 w-3 text-stone-400" />
                      )}
                      <Link
                        href={crumb.href}
                        className={cn(
                          'transition-colors hover:underline',
                          index === getBreadcrumbs().length - 1
                            ? 'font-medium text-stone-900 dark:text-gray-100'
                            : 'text-stone-500 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200'
                        )}
                      >
                        {crumb.text}
                      </Link>
                    </li>
                  ))}
                </ol>
              </nav>
            )}
          </div>

          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <ReturnToChatButton />
          </div>
        </div>
      </header>
      <aside
        className={cn(
          'fixed top-0 bottom-0 left-0 flex flex-col border-r',
          'transition-[width] duration-150 ease-out',
          isExpanded ? 'w-72' : 'w-16',
          !isMounted && 'opacity-0',
          'z-45',
          'bg-stone-200 dark:bg-stone-700',
          'backdrop-blur-sm',
          'border-r-stone-300/60 text-stone-700 shadow-xl shadow-stone-300/60',
          'dark:border-r-stone-700/50 dark:text-stone-300 dark:shadow-xl dark:shadow-black/40'
        )}
        onMouseEnter={() => handleSetHovering(true)}
        onMouseLeave={() => handleSetHovering(false)}
      >
        <div className="flex h-full flex-col">
          <div className="px-3 pt-16 pb-4">
            <div className="space-y-1">
              {menuItems.map(item => {
                const isCurrentPage =
                  pathname === item.href ||
                  (item.href !== '/admin' && pathname.startsWith(item.href));
                const isNavigatingToThis = navigatingTo === item.href;
                const isActive =
                  isNavigatingToThis || (isCurrentPage && !navigatingTo);

                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => handleMenuClick(item.href)}
                    className={cn(
                      'relative flex items-center rounded-lg px-3 py-2 text-sm font-medium',
                      'transition-all duration-200 ease-in-out',
                      'outline-none focus-visible:ring-2 focus-visible:ring-offset-2',
                      'focus-visible:ring-primary focus-visible:ring-offset-background',
                      'dark:focus-visible:ring-stone-500 dark:focus-visible:ring-offset-gray-900',
                      'h-10 min-h-[2.5rem] border border-transparent',
                      // Light mode styles
                      'text-stone-600 hover:bg-stone-300 hover:shadow-md',
                      isActive && 'border-stone-400/80 bg-stone-300 shadow-sm',
                      // Dark mode styles
                      'dark:text-gray-200 dark:hover:border-stone-500/50 dark:hover:bg-stone-600 dark:hover:shadow-md',
                      isActive &&
                        'dark:border-stone-500 dark:bg-stone-600 dark:shadow-sm',
                      isExpanded ? 'w-full' : 'w-10 justify-center'
                    )}
                  >
                    <div className="flex min-w-0 flex-1 items-center">
                      <span
                        className={cn(
                          '-ml-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center',
                          'text-gray-500 dark:text-gray-400'
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </span>
                      {isExpanded && contentVisible && (
                        <div
                          className={cn(
                            'ml-2 min-w-0 flex-1 truncate font-serif',
                            'flex items-center leading-snug'
                          )}
                        >
                          {item.text}
                        </div>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </aside>

      <main
        className={cn(
          'relative ml-16 min-h-screen pt-12 transition-all duration-150 ease-out'
        )}
      >
        {children}
      </main>
    </div>
  );
}
