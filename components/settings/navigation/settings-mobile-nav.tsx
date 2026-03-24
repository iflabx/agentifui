'use client';

import { useSettingsColors } from '@lib/hooks/use-settings-colors';
import { cn } from '@lib/utils';
import { ChevronDown } from 'lucide-react';

import { useState } from 'react';

import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from 'next/navigation';

// Reuse the same settings item definition
import { getSettingsNavItems } from './settings-sidebar';

// Settings item type definition
type SettingsNavItem = {
  title: string;
  href: string;
  icon: React.ElementType;
};

export function SettingsMobileNav() {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const { colors } = useSettingsColors();
  const t = useTranslations('pages.settings');
  const [isOpen, setIsOpen] = useState(false);

  // Get the currently selected navigation item based on the current path
  // Find the matching navigation item based on the current path
  const navItems = getSettingsNavItems(t);
  const currentItem =
    navItems.find((item: SettingsNavItem) => item.href === pathname) ||
    navItems[0]; // Default to use the first item (overview)

  const handleSelectChange = (path: string) => {
    router.push(path);
    setIsOpen(false);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          'flex w-full items-center justify-between rounded-lg px-4 py-3 text-sm',
          `${colors.borderColor.tailwind}`,
          colors.sidebarItemActive.tailwind
        )}
      >
        <span className="flex items-center font-serif">
          {currentItem.icon && (
            <span className="mr-3">
              {currentItem.icon && <currentItem.icon className="h-5 w-5" />}
            </span>
          )}
          {currentItem.title}
        </span>
        <span>
          <ChevronDown
            className={cn(
              'h-4 w-4 transition-transform',
              isOpen ? 'rotate-180' : ''
            )}
          />
        </span>
      </button>

      {isOpen && (
        <div
          className={cn(
            'absolute right-0 left-0 z-10 mt-1 rounded-lg shadow-lg',
            `${colors.borderColor.tailwind}`,
            colors.cardBackground.tailwind
          )}
        >
          <div className="py-1">
            {navItems.map((item: SettingsNavItem) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.href}
                  onClick={() => handleSelectChange(item.href)}
                  className={cn(
                    'flex w-full items-center px-4 py-3 text-left text-sm',
                    'transition-colors duration-200',
                    pathname === item.href
                      ? `${colors.sidebarItemActive.tailwind} font-medium`
                      : colors.sidebarItemHover.tailwind
                  )}
                >
                  <span className="mr-3">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="font-serif">{item.title}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
