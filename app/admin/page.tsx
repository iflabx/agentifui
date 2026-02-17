'use client';

import { cn } from '@lib/utils';
import {
  ArrowRight,
  Bell,
  Bug,
  Building2,
  Key,
  KeyRound,
  ShieldCheck,
  Users,
} from 'lucide-react';

import React from 'react';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

interface AdminCardProps {
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
}

function AdminCard({ title, description, icon: Icon, href }: AdminCardProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group block rounded-xl border p-6 transition-all duration-200 hover:shadow-lg',
        'dark:hover:bg-stone-750 border-stone-200 bg-white hover:border-stone-300 hover:shadow-stone-200/50 dark:border-stone-700 dark:bg-stone-800 dark:hover:border-stone-600'
      )}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-3 flex items-center gap-3">
            <div
              className={cn('rounded-lg p-2', 'bg-stone-100 dark:bg-stone-700')}
            >
              <Icon
                className={cn('h-5 w-5', 'text-stone-600 dark:text-stone-300')}
              />
            </div>
            <h3
              className={cn(
                'text-lg font-semibold',
                'text-stone-900 dark:text-stone-100'
              )}
            >
              {title}
            </h3>
          </div>

          <p
            className={cn(
              'text-sm leading-relaxed',
              'text-stone-600 dark:text-stone-400'
            )}
          >
            {description}
          </p>
        </div>

        <ArrowRight
          className={cn(
            'h-5 w-5 transition-transform group-hover:translate-x-1',
            'text-stone-400'
          )}
        />
      </div>
    </Link>
  );
}

export default function AdminPage() {
  const t = useTranslations('pages.admin.main');
  const tLayout = useTranslations('pages.admin.layout');

  const adminCards: AdminCardProps[] = [
    {
      title: tLayout('menuItems.apiConfig.text'),
      description: tLayout('menuItems.apiConfig.description'),
      icon: Key,
      href: '/admin/api-config',
    },
    {
      title: tLayout('menuItems.content.text'),
      description: tLayout('menuItems.content.description'),
      icon: Bell,
      href: '/admin/content',
    },
    {
      title: tLayout('menuItems.users.text'),
      description: tLayout('menuItems.users.description'),
      icon: Users,
      href: '/admin/users',
    },
    {
      title: tLayout('menuItems.ssoProviders.text'),
      description: tLayout('menuItems.ssoProviders.description'),
      icon: KeyRound,
      href: '/admin/sso-providers',
    },
    {
      title: tLayout('menuItems.groups.text'),
      description: tLayout('menuItems.groups.description'),
      icon: Building2,
      href: '/admin/groups',
    },
    {
      title: tLayout('menuItems.permissions.text'),
      description: tLayout('menuItems.permissions.description'),
      icon: ShieldCheck,
      href: '/admin/permissions',
    },
    {
      title: 'Errors',
      description: 'Unified error observability and diagnostics',
      icon: Bug,
      href: '/admin/errors',
    },
  ];

  return (
    <div className="min-h-full">
      <div className="mx-auto max-w-7xl p-6">
        <div className="mb-8">
          <h1
            className={cn(
              'mb-3 bg-gradient-to-r bg-clip-text text-4xl font-bold text-transparent',
              'from-stone-800 to-stone-600 dark:from-stone-100 dark:to-stone-300'
            )}
          >
            {t('title')}
          </h1>
          <p className={cn('text-base', 'text-stone-600 dark:text-stone-400')}>
            {t('subtitle')}
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {adminCards.map(card => (
            <AdminCard
              key={card.href}
              title={card.title}
              description={card.description}
              icon={card.icon}
              href={card.href}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
