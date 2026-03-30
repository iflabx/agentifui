'use client';

import { DynamicAboutRenderer } from '@components/about/dynamic-about-renderer';
import { AdminButton } from '@components/admin/admin-button';
import { LanguageSwitcher } from '@components/ui/language-switcher';
import { PageLoader } from '@components/ui/page-loader';
import { getCurrentUser } from '@lib/auth/better-auth/http-client';
import { usePageContent } from '@lib/hooks/use-page-content';
import type { AboutTranslationData } from '@lib/types/about-page-components';

import { useEffect, useMemo, useState } from 'react';

import { useRouter } from 'next/navigation';

export default function AboutPage() {
  const router = useRouter();
  const { pageContent, isLoading } = usePageContent({ page: 'about' });
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const colors = {
    bgClass: 'bg-stone-100 dark:bg-stone-900',
  };

  const handleExploreClick = async () => {
    try {
      const user = await getCurrentUser();

      if (user) {
        router.push('/chat');
      } else {
        router.push('/login');
      }
    } catch (error) {
      console.error('check login status failed:', error);
      router.push('/login');
    }
  };

  const translationData = useMemo<AboutTranslationData | null>(() => {
    if (!pageContent) {
      return null;
    }

    return {
      sections: pageContent.sections,
      metadata: pageContent.metadata,
    };
  }, [pageContent]);

  if (!mounted || isLoading) {
    return <PageLoader />;
  }

  return (
    <div
      className={`relative min-h-screen w-full px-4 py-12 sm:px-6 lg:px-8 ${colors.bgClass}`}
    >
      <div className="fixed top-4 right-4 z-50 hidden flex-col items-end gap-2 sm:flex sm:flex-row sm:items-center sm:gap-3 lg:top-6 lg:right-6">
        <AdminButton />
        <LanguageSwitcher variant="floating" />
      </div>

      <main className="mx-auto max-w-5xl">
        {translationData ? (
          <DynamicAboutRenderer
            translationData={translationData}
            onButtonClick={handleExploreClick}
          />
        ) : (
          <div className="flex min-h-[50vh] items-center justify-center text-sm text-stone-500 dark:text-stone-400">
            About page content is unavailable.
          </div>
        )}
      </main>
    </div>
  );
}
