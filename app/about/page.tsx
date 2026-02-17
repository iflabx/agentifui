'use client';

import { DynamicAboutRenderer } from '@components/about/dynamic-about-renderer';
import { AdminButton } from '@components/admin/admin-button';
import { LanguageSwitcher } from '@components/ui/language-switcher';
import { PageLoader } from '@components/ui/page-loader';
import { getCurrentUser } from '@lib/auth/better-auth/http-client';
import { useDynamicTranslations } from '@lib/hooks/use-dynamic-translations';
import type {
  AboutTranslationData,
  PageSection,
} from '@lib/types/about-page-components';

import { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

export default function AboutPage() {
  const router = useRouter();
  const staticT = useTranslations('pages.about');
  const { t: dynamicT, isLoading } = useDynamicTranslations({
    sections: ['pages.about'],
  });
  const [mounted, setMounted] = useState(false);

  // enhanced translation function that tries dynamic first, then static fallback
  const t = (key: string, params?: Record<string, string | number>) => {
    const dynamicValue = dynamicT(key, 'pages.about', params);
    return dynamicValue || staticT(key, params);
  };

  // ensure client-side rendering consistency
  useEffect(() => {
    setMounted(true);
  }, []);

  // Homepage-style colors using Tailwind classes
  const colors = {
    bgClass: 'bg-stone-100 dark:bg-stone-900',
  };

  // handle "start exploring" button click
  const handleExploreClick = async () => {
    try {
      // check if user is logged in
      const user = await getCurrentUser();

      if (user) {
        // user is logged in, redirect to chat page
        router.push('/chat');
      } else {
        // user is not logged in, redirect to login page
        router.push('/login');
      }
    } catch (error) {
      console.error('check login status failed:', error);
      // if error, redirect to login page
      router.push('/login');
    }
  };

  // Show loading state while mounting or dynamic translations load
  if (!mounted || isLoading) {
    return <PageLoader />;
  }

  // Create translation data object for the dynamic renderer
  const translationData: AboutTranslationData = {
    // Try to get dynamic sections first
    sections: dynamicT<PageSection[]>('sections', 'pages.about') || undefined,

    // Fallback to legacy format for backward compatibility
    title: t('title'),
    subtitle: t('subtitle'),
    mission: {
      description: t('mission.description'),
    },
    values: {
      items: staticT.raw('values.items') as Array<{
        title: string;
        description: string;
      }>,
    },
    buttonText: t('buttonText'),
    copyright: {
      prefix: t('copyright.prefix'),
      linkText: t('copyright.linkText'),
      suffix: t('copyright.suffix'),
    },
  };

  return (
    <div
      className={`relative min-h-screen w-full px-4 py-12 sm:px-6 lg:px-8 ${colors.bgClass}`}
    >
      {/* Top-right toolbar: Admin button (left) + Language switcher (right) */}
      <div className="fixed top-4 right-4 z-50 hidden flex-col items-end gap-2 sm:flex sm:flex-row sm:items-center sm:gap-3 lg:top-6 lg:right-6">
        <AdminButton />
        <LanguageSwitcher variant="floating" />
      </div>

      <main className="mx-auto max-w-5xl">
        <DynamicAboutRenderer
          translationData={translationData}
          onButtonClick={handleExploreClick}
        />
      </main>
    </div>
  );
}
