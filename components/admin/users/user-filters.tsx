'use client';

import type { UserFilters } from '@lib/db/users';
import { useTheme } from '@lib/hooks/use-theme';
import { cn } from '@lib/utils';
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Crown,
  RotateCcw,
  Search,
  Settings,
  Shield,
  UserCheck,
  UserIcon,
  UserX,
  Users,
} from 'lucide-react';

import React, { useState } from 'react';

import { useTranslations } from 'next-intl';

interface UserFiltersProps {
  filters: UserFilters;
  onFiltersChange: (filters: Partial<UserFilters>) => void;
  onReset: () => void;
}

export const UserFiltersComponent: React.FC<UserFiltersProps> = ({
  filters,
  onFiltersChange,
  onReset,
}) => {
  const { isDark } = useTheme();
  const [isExpanded, setIsExpanded] = useState(false);
  const t = useTranslations('pages.admin.users.filters');

  // Role options
  const roleOptions = [
    {
      value: '',
      label: t('roleOptions.all'),
      icon: <Users className="h-4 w-4" />,
    },
    {
      value: 'admin',
      label: t('roleOptions.admin'),
      icon: <Shield className="h-4 w-4" />,
    },
    {
      value: 'manager',
      label: t('roleOptions.manager'),
      icon: <Crown className="h-4 w-4" />,
    },
    {
      value: 'user',
      label: t('roleOptions.user'),
      icon: <UserIcon className="h-4 w-4" />,
    },
  ];

  // Status options
  const statusOptions = [
    {
      value: '',
      label: t('statusOptions.all'),
      icon: <Users className="h-4 w-4" />,
    },
    {
      value: 'active',
      label: t('statusOptions.active'),
      icon: <UserCheck className="h-4 w-4" />,
    },
    {
      value: 'suspended',
      label: t('statusOptions.suspended'),
      icon: <UserX className="h-4 w-4" />,
    },
    {
      value: 'pending',
      label: t('statusOptions.pending'),
      icon: <Clock className="h-4 w-4" />,
    },
  ];

  // Authentication source options (directly corresponding to the provider value of Supabase)
  const authSourceOptions = [
    { value: '', label: t('authSourceOptions.all') },
    { value: 'email', label: t('authSourceOptions.email') },
    { value: 'github', label: '🐙 GitHub' },
    { value: 'phone', label: t('authSourceOptions.phone') },
    { value: 'google', label: '🔍 Google' },
  ];

  // Sort options
  const sortOptions = [
    { value: 'created_at', label: t('sortOptions.createdAt') },
    { value: 'last_sign_in_at', label: t('sortOptions.lastSignIn') },
    { value: 'email', label: t('sortOptions.email') },
    { value: 'full_name', label: t('sortOptions.fullName') },
  ];

  // Handle search input
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFiltersChange({ search: e.target.value });
  };

  // Check if any filter conditions are applied (remove organization department check)
  const hasActiveFilters =
    filters.role || filters.status || filters.auth_source || filters.search;
  const hasSearchFilter = filters.search;

  return (
    <div
      className={cn(
        'mb-4 rounded-xl border backdrop-blur-sm',
        isDark
          ? 'border-stone-700/50 bg-stone-900/80'
          : 'border-stone-200/50 bg-white/90'
      )}
    >
      {/* Search bar - always visible */}
      <div className="p-4">
        <div className="flex items-center gap-4">
          {/* --- Search box --- */}
          <div className="relative flex-1">
            <Search
              className={cn(
                'absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 transform',
                isDark ? 'text-stone-400' : 'text-stone-500'
              )}
            />
            <input
              type="text"
              placeholder={t('searchPlaceholder')}
              value={filters.search || ''}
              onChange={handleSearchChange}
              className={cn(
                'placeholder-opacity-60 w-full rounded-lg border py-2.5 pr-4 pl-10 font-serif text-sm',
                'focus:ring-2 focus:ring-offset-1 focus:outline-none',
                isDark
                  ? 'border-stone-600 bg-stone-800/50 text-stone-100 placeholder-stone-500 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                  : 'border-stone-300 bg-stone-50/50 text-stone-900 placeholder-stone-500 focus:ring-stone-400/30 focus:ring-offset-white',
                'transition-all duration-200'
              )}
            />
          </div>

          {/* --- Expand/collapse button --- */}
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={cn(
              'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all duration-200',
              isDark
                ? 'border-stone-600 text-stone-300 hover:border-stone-500 hover:bg-stone-700/50 hover:text-stone-100'
                : 'border-stone-300 text-stone-600 hover:border-stone-400 hover:bg-stone-50 hover:text-stone-800'
            )}
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">{t('advancedFilters')}</span>
            {isExpanded ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
            {(hasActiveFilters || hasSearchFilter) && (
              <div
                className={cn(
                  'ml-1 h-2 w-2 rounded-full',
                  isDark ? 'bg-emerald-400' : 'bg-emerald-500'
                )}
              />
            )}
          </button>

          {/* --- Reset button --- */}
          {(hasActiveFilters || hasSearchFilter) && (
            <button
              onClick={onReset}
              className={cn(
                'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium transition-all duration-200',
                isDark
                  ? 'border-stone-600 text-stone-300 hover:border-stone-500 hover:bg-stone-700/50 hover:text-stone-100'
                  : 'border-stone-300 text-stone-600 hover:border-stone-400 hover:bg-stone-50 hover:text-stone-800'
              )}
            >
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">{t('reset')}</span>
            </button>
          )}
        </div>
      </div>

      {/* Collapsible advanced filter area */}
      {isExpanded && (
        <div
          className={cn(
            'border-t px-4 pb-4',
            isDark ? 'border-stone-700/50' : 'border-stone-200/50'
          )}
        >
          <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {/* --- Role filter --- */}
            <div>
              <label
                className={cn(
                  'mb-2 block font-serif text-xs font-semibold tracking-wider uppercase',
                  isDark ? 'text-stone-400' : 'text-stone-600'
                )}
              >
                {t('rolePermissions')}
              </label>
              <div className="relative">
                <select
                  value={filters.role || ''}
                  onChange={e =>
                    onFiltersChange({
                      role: e.target.value
                        ? (e.target.value as NonNullable<UserFilters['role']>)
                        : undefined,
                    })
                  }
                  className={cn(
                    'w-full cursor-pointer appearance-none rounded-lg border px-3 py-2 font-serif text-sm',
                    'focus:ring-2 focus:ring-offset-1 focus:outline-none',
                    isDark
                      ? 'border-stone-600 bg-stone-800/50 text-stone-100 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                      : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:ring-stone-400/30 focus:ring-offset-white',
                    'transition-all duration-200'
                  )}
                >
                  {roleOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className={cn(
                    'pointer-events-none absolute top-1/2 right-2 h-3 w-3 -translate-y-1/2 transform',
                    isDark ? 'text-stone-500' : 'text-stone-400'
                  )}
                />
              </div>
            </div>

            {/* --- Status filter --- */}
            <div>
              <label
                className={cn(
                  'mb-2 block font-serif text-xs font-semibold tracking-wider uppercase',
                  isDark ? 'text-stone-400' : 'text-stone-600'
                )}
              >
                {t('accountStatus')}
              </label>
              <div className="relative">
                <select
                  value={filters.status || ''}
                  onChange={e =>
                    onFiltersChange({
                      status: e.target.value
                        ? (e.target.value as NonNullable<UserFilters['status']>)
                        : undefined,
                    })
                  }
                  className={cn(
                    'w-full cursor-pointer appearance-none rounded-lg border px-3 py-2 font-serif text-sm',
                    'focus:ring-2 focus:ring-offset-1 focus:outline-none',
                    isDark
                      ? 'border-stone-600 bg-stone-800/50 text-stone-100 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                      : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:ring-stone-400/30 focus:ring-offset-white',
                    'transition-all duration-200'
                  )}
                >
                  {statusOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className={cn(
                    'pointer-events-none absolute top-1/2 right-2 h-3 w-3 -translate-y-1/2 transform',
                    isDark ? 'text-stone-500' : 'text-stone-400'
                  )}
                />
              </div>
            </div>

            {/* --- Authentication source filter --- */}
            <div>
              <label
                className={cn(
                  'mb-2 block font-serif text-xs font-semibold tracking-wider uppercase',
                  isDark ? 'text-stone-400' : 'text-stone-600'
                )}
              >
                {t('authSource')}
              </label>
              <div className="relative">
                <select
                  value={filters.auth_source || ''}
                  onChange={e =>
                    onFiltersChange({
                      auth_source: e.target.value || undefined,
                    })
                  }
                  className={cn(
                    'w-full cursor-pointer appearance-none rounded-lg border px-3 py-2 font-serif text-sm',
                    'focus:ring-2 focus:ring-offset-1 focus:outline-none',
                    isDark
                      ? 'border-stone-600 bg-stone-800/50 text-stone-100 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                      : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:ring-stone-400/30 focus:ring-offset-white',
                    'transition-all duration-200'
                  )}
                >
                  {authSourceOptions.map(option => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  className={cn(
                    'pointer-events-none absolute top-1/2 right-2 h-3 w-3 -translate-y-1/2 transform',
                    isDark ? 'text-stone-500' : 'text-stone-400'
                  )}
                />
              </div>
            </div>

            {/* --- Sort selection --- */}
            <div>
              <label
                className={cn(
                  'mb-2 block font-serif text-xs font-semibold tracking-wider uppercase',
                  isDark ? 'text-stone-400' : 'text-stone-600'
                )}
              >
                {t('sortBy')}
              </label>
              <div className="space-y-2">
                <div className="relative">
                  <select
                    value={filters.sortBy || 'created_at'}
                    onChange={e =>
                      onFiltersChange({
                        sortBy: e.target.value as NonNullable<
                          UserFilters['sortBy']
                        >,
                      })
                    }
                    className={cn(
                      'w-full cursor-pointer appearance-none rounded-lg border px-3 py-1.5 font-serif text-sm',
                      'focus:ring-2 focus:ring-offset-1 focus:outline-none',
                      isDark
                        ? 'border-stone-600 bg-stone-800/50 text-stone-100 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                        : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:ring-stone-400/30 focus:ring-offset-white',
                      'transition-all duration-200'
                    )}
                  >
                    {sortOptions.map(option => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    className={cn(
                      'pointer-events-none absolute top-1/2 right-2 h-3 w-3 -translate-y-1/2 transform',
                      isDark ? 'text-stone-500' : 'text-stone-400'
                    )}
                  />
                </div>
                <div className="relative">
                  <select
                    value={filters.sortOrder || 'desc'}
                    onChange={e =>
                      onFiltersChange({
                        sortOrder: e.target.value as NonNullable<
                          UserFilters['sortOrder']
                        >,
                      })
                    }
                    className={cn(
                      'w-full cursor-pointer appearance-none rounded-lg border px-3 py-1.5 font-serif text-sm',
                      'focus:ring-2 focus:ring-offset-1 focus:outline-none',
                      isDark
                        ? 'border-stone-600 bg-stone-800/50 text-stone-100 focus:ring-stone-500/30 focus:ring-offset-stone-900'
                        : 'border-stone-300 bg-stone-50/50 text-stone-900 focus:ring-stone-400/30 focus:ring-offset-white',
                      'transition-all duration-200'
                    )}
                  >
                    <option value="desc">{t('sortOrder.desc')}</option>
                    <option value="asc">{t('sortOrder.asc')}</option>
                  </select>
                  <ChevronDown
                    className={cn(
                      'pointer-events-none absolute top-1/2 right-2 h-3 w-3 -translate-y-1/2 transform',
                      isDark ? 'text-stone-500' : 'text-stone-400'
                    )}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
