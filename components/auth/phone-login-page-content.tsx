'use client';

import PhoneAuth from '@components/auth/phone-auth';
import { cn } from '@lib/utils';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

export default function PhoneLoginPageContent() {
  const t = useTranslations('pages.auth.phoneLoginPage');

  return (
    <div
      className={cn(
        'flex min-h-screen items-center justify-center p-4',
        'bg-gradient-to-br from-stone-50 via-stone-100 to-stone-50 dark:from-stone-900 dark:via-gray-900 dark:to-stone-900'
      )}
    >
      <div className="w-full max-w-md space-y-6">
        {/* --- header title --- */}
        <div className="space-y-2 text-center">
          <h1
            className={cn(
              'font-serif text-3xl font-bold tracking-tight',
              'text-gray-900 dark:text-gray-100'
            )}
          >
            {t('title')}
          </h1>
          <p
            className={cn(
              'font-serif text-sm',
              'text-gray-600 dark:text-gray-400'
            )}
          >
            {t('subtitle')}
          </p>
        </div>

        {/* --- phone number authentication component --- */}
        <PhoneAuth />

        {/* --- other login methods --- */}
        <div
          className={cn(
            'rounded-xl border p-6 font-serif shadow-lg transition-all',
            'border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900'
          )}
        >
          <div className="space-y-4 text-center">
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span
                  className={cn(
                    'w-full border-t',
                    'border-stone-300 dark:border-stone-700'
                  )}
                />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span
                  className={cn(
                    'px-2 font-serif',
                    'bg-stone-50 text-gray-500 dark:bg-stone-900 dark:text-gray-400'
                  )}
                >
                  {t('orSeparator')}
                </span>
              </div>
            </div>

            <div className="flex flex-col space-y-2">
              <Link
                href="/login"
                className={cn(
                  'font-serif text-sm hover:underline',
                  'text-stone-600 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300'
                )}
              >
                {t('emailLoginLink')}
              </Link>
              <Link
                href="/register"
                className={cn(
                  'font-serif text-sm hover:underline',
                  'text-gray-600 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                )}
              >
                {t('registerLink')}
              </Link>
            </div>
          </div>
        </div>

        {/* --- bottom description --- */}
        <p className={cn('text-center font-serif text-xs', 'text-gray-500')}>
          {t('termsText')}{' '}
          <Link
            href="/terms"
            className={cn(
              'underline',
              'hover:text-gray-700 dark:hover:text-gray-400'
            )}
          >
            {t('termsLink')}
          </Link>{' '}
          {t('andText')}{' '}
          <Link
            href="/privacy"
            className={cn(
              'underline',
              'hover:text-gray-700 dark:hover:text-gray-400'
            )}
          >
            {t('privacyLink')}
          </Link>
        </p>
      </div>
    </div>
  );
}
