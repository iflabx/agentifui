'use client';

import { LogoutConfirmDialog } from '@components/ui/logout-confirm-dialog';
import { UserAvatar } from '@components/ui/user-avatar';
import { VersionTag } from '@components/ui/version-tag';
import { useProfile } from '@lib/hooks/use-profile';
import { cn } from '@lib/utils';
import { Clock, Info, LogOut, Sliders, UserCircle, Wrench } from 'lucide-react';

import React, { useEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

export function DesktopUserAvatar() {
  const router = useRouter();
  const t = useTranslations('navbar.user');
  const tRoles = useTranslations('pages.settings.profileSettings.roles');
  const { profile } = useProfile();

  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [hoveredItem, setHoveredItem] = useState<string | null>(null);
  const [showLogoutDialog, setShowLogoutDialog] = useState(false);

  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        triggerRef.current &&
        !triggerRef.current.contains(event.target as Node)
      ) {
        setIsDropdownOpen(false);
      }
    };

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isDropdownOpen]);

  const toggleDropdown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropdownOpen(prev => {
      if (prev) {
        setHoveredItem(null);
      }
      return !prev;
    });
  };

  const handleMenuItemClick = (action: () => void) => {
    action();
    setIsDropdownOpen(false);
    setHoveredItem(null);
  };

  const handleLogout = () => {
    setShowLogoutDialog(true);
    setIsDropdownOpen(false);
    setHoveredItem(null);
  };

  const menuItems = [
    {
      icon: Clock,
      label: t('history'),
      action: () => router.push('/chat/history'),
    },
    {
      icon: Sliders,
      label: t('settings'),
      action: () => router.push('/settings'),
    },
    {
      icon: Info,
      label: t('about'),
      action: () => router.push('/about'),
    },
  ];

  const adminMenuItems = [
    {
      icon: Wrench,
      label: t('admin'),
      action: () => router.push('/admin'),
    },
  ];

  const allMenuItems =
    profile?.role === 'admin' ? [...menuItems, ...adminMenuItems] : menuItems;

  const isLoggedIn = !!profile;
  const userName = profile?.full_name || profile?.username || t('userMenu');
  const userRole =
    profile?.role === 'admin'
      ? tRoles('admin')
      : profile?.role === 'manager'
        ? tRoles('manager')
        : tRoles('user');
  const avatarUrl = profile?.avatar_url;

  return (
    <>
      <LogoutConfirmDialog
        isOpen={showLogoutDialog}
        onClose={() => setShowLogoutDialog(false)}
      />

      <div className="relative mr-1">
        <button
          ref={triggerRef}
          onClick={toggleDropdown}
          className="relative flex h-9 w-9 cursor-pointer items-center justify-center rounded-full transition-all duration-200 hover:ring-2 hover:ring-stone-400/50 focus:ring-2 focus:ring-stone-400/50 focus:outline-none"
          aria-label={isLoggedIn ? t('userMenu') : t('login')}
        >
          {isLoggedIn ? (
            <UserAvatar
              avatarUrl={avatarUrl}
              userName={userName}
              size="lg"
              className="h-9 w-9 transition-all duration-200"
            />
          ) : (
            <div
              className={cn(
                'flex h-9 w-9 items-center justify-center rounded-full border-2 transition-all duration-200',
                'border-stone-300 bg-stone-100 text-stone-600 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-200'
              )}
            >
              <UserCircle size={18} />
            </div>
          )}
        </button>
        {isDropdownOpen && (
          <div
            ref={dropdownRef}
            className={cn(
              'animate-slide-in-down absolute top-12 -right-2 z-50 w-64 rounded-xl border p-2 shadow-xl',
              'border-stone-200 bg-stone-50 dark:border-stone-600 dark:bg-stone-800'
            )}
          >
            {isLoggedIn ? (
              <>
                <div
                  className={cn(
                    'mb-2 rounded-lg p-3',
                    'bg-stone-200/80 dark:bg-stone-700/50'
                  )}
                >
                  <div className="flex items-center">
                    <div className="min-w-0 flex-1">
                      <p
                        className={cn(
                          'truncate font-serif text-sm font-semibold',
                          'text-stone-900 dark:text-stone-100'
                        )}
                      >
                        {userName}
                      </p>
                      <p
                        className={cn(
                          'truncate font-serif text-xs',
                          'text-stone-600 dark:text-stone-300'
                        )}
                      >
                        {userRole}
                      </p>
                    </div>
                  </div>
                </div>

                <div
                  className={cn(
                    'mb-2 h-px w-full',
                    'bg-stone-200 dark:bg-stone-600'
                  )}
                />

                <div className="space-y-1">
                  {allMenuItems.map((item, index) => {
                    const itemKey = `menu-${index}`;
                    const isHovered = hoveredItem === itemKey;

                    return (
                      <button
                        key={index}
                        onClick={() => handleMenuItemClick(item.action)}
                        className={cn(
                          'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors duration-150 focus:outline-none',
                          isHovered
                            ? 'bg-stone-200 text-stone-800 dark:bg-stone-700 dark:text-stone-200'
                            : 'bg-transparent text-stone-700 dark:text-stone-200'
                        )}
                        onMouseEnter={() => setHoveredItem(itemKey)}
                        onMouseLeave={() => setHoveredItem(null)}
                      >
                        <item.icon
                          className={cn(
                            'h-4 w-4',
                            'text-stone-500 dark:text-stone-400'
                          )}
                        />
                        <span
                          className={cn(
                            'flex-1 font-serif text-sm',
                            'text-stone-700 dark:text-stone-200'
                          )}
                        >
                          {item.label}
                        </span>
                        {item.label === t('about') && (
                          <span className="ml-auto">
                            <VersionTag variant="tag" size="xs" />
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div
                  className={cn(
                    'my-2 h-px w-full',
                    'bg-stone-200 dark:bg-stone-600'
                  )}
                />

                <button
                  onClick={handleLogout}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left font-serif text-sm transition-colors duration-150 focus:outline-none',
                    'text-red-600',
                    hoveredItem === 'logout'
                      ? 'bg-red-50 dark:bg-red-900/20'
                      : 'bg-transparent'
                  )}
                  onMouseEnter={() => setHoveredItem('logout')}
                  onMouseLeave={() => setHoveredItem(null)}
                >
                  <LogOut className="h-4 w-4" />
                  <span className="font-serif text-sm">{t('logout')}</span>
                </button>
              </>
            ) : (
              <div className="p-4">
                <div
                  className={cn(
                    'mb-6 rounded-xl px-4 py-6 text-center',
                    'bg-stone-200/80 text-stone-600 dark:bg-stone-700/50 dark:text-stone-200'
                  )}
                >
                  <UserCircle
                    className={cn(
                      'mx-auto mb-3 h-16 w-16',
                      'text-stone-500 dark:text-stone-400'
                    )}
                  />
                  <p className="font-serif font-medium">{t('loginPrompt')}</p>
                  <p className="mt-1 font-serif text-sm opacity-75">
                    {t('loginDescription')}
                  </p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={() =>
                      handleMenuItemClick(() => router.push('/login'))
                    }
                    className={cn(
                      'w-full transform rounded-xl px-4 py-3 text-center font-serif font-semibold text-white shadow-lg transition-all duration-200 hover:scale-[1.02] hover:shadow-xl',
                      hoveredItem === 'login' ? 'bg-stone-700' : 'bg-stone-600'
                    )}
                    onMouseEnter={() => setHoveredItem('login')}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    {t('login')}
                  </button>

                  <button
                    onClick={() =>
                      handleMenuItemClick(() => router.push('/register'))
                    }
                    className={cn(
                      'w-full transform rounded-xl border px-4 py-3 text-center font-serif font-medium shadow-sm transition-all duration-200 hover:scale-[1.02] hover:shadow-md',
                      hoveredItem === 'register'
                        ? 'border-stone-300 bg-stone-300 text-stone-800 dark:border-stone-600 dark:bg-stone-600 dark:text-stone-100'
                        : 'border-stone-300 bg-stone-100 text-stone-700 dark:border-stone-600 dark:bg-stone-700 dark:text-stone-200'
                    )}
                    onMouseEnter={() => setHoveredItem('register')}
                    onMouseLeave={() => setHoveredItem(null)}
                  >
                    {t('register')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
