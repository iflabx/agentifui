'use client';

import { cn } from '@lib/utils';

import { useEffect } from 'react';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

/**
 * Legacy SSO processing page.
 * The old CAS -> legacy session bootstrap flow has been removed.
 */
export default function SSOProcessingPage() {
  const router = useRouter();
  const t = useTranslations('pages.auth.sso.processing');

  useEffect(() => {
    const timer = window.setTimeout(() => {
      router.replace('/login?error=auth_flow_replaced');
    }, 1200);

    return () => window.clearTimeout(timer);
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-100 dark:bg-stone-800">
      <div className="mx-4 w-full max-w-md space-y-4 rounded-xl border border-stone-200 bg-stone-50 p-8 text-center shadow-lg dark:border-stone-800 dark:bg-stone-900">
        <h1 className="bg-gradient-to-r from-stone-700 to-stone-500 bg-clip-text py-1 text-2xl leading-normal font-bold text-transparent">
          {t('title')}
        </h1>
        <p className={cn('text-sm text-stone-700 dark:text-stone-300')}>
          {t('failed')}
        </p>
      </div>
    </div>
  );
}
