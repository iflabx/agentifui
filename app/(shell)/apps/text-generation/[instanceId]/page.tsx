'use client';

import { TextGenerationLayout } from '@components/text-generation/text-generation-layout';
import { useCurrentApp } from '@lib/hooks/use-current-app';
import { useAppListStore } from '@lib/stores/app-list-store';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';
import { FileText, Loader2 } from 'lucide-react';

import React, { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

interface TextGenerationPageProps {
  params: Promise<{
    instanceId: string;
  }>;
}

/**
 * text generation app page
 *
 * features:
 * - real-time text generation based on streaming API
 * - dynamic input form (based on user_input_form configuration)
 * - complete execution history management
 * - responsive design, support mobile
 * - unified stone color theme
 * - reuse workflow's complete architecture
 */
export default function TextGenerationPage({
  params,
}: TextGenerationPageProps) {
  const { instanceId } = React.use(params);
  const router = useRouter();
  const t = useTranslations('pages.apps');

  // --- app related state ---
  const { apps, fetchApps } = useAppListStore();
  const { currentAppId, isValidating, switchToSpecificApp } = useCurrentApp();
  const { selectItem } = useSidebarStore();

  // --- app initialization state ---
  const [isInitializing, setIsInitializing] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);

  // --- get current app instance data ---
  const currentApp = apps.find(app => app.instance_id === instanceId);

  // --- page initialization: switch to target app and synchronize sidebar selected state ---
  useEffect(() => {
    const initializeApp = async () => {
      if (!instanceId) return;

      try {
        setInitError(null);

        console.log(
          '[text generation page] start initializing app:',
          instanceId
        );

        const needsAppListFetch = apps.length === 0;
        const currentAppMatches = currentAppId === instanceId;

        // If the application list is empty, it needs to be fetched
        if (needsAppListFetch) {
          setIsInitializing(true);
          console.log(
            '[text generation page] app list is empty, start fetching'
          );
          await fetchApps();
        }

        // Re-fetch the latest application list
        const latestApps = useAppListStore.getState().apps;
        console.log(
          '[text generation page] current app list length:',
          latestApps.length
        );

        // Check if the application exists
        const targetApp = latestApps.find(
          app => app.instance_id === instanceId
        );
        if (!targetApp) {
          console.error('[text generation page] app not found:', instanceId);
          setInitError(t('errors.appNotFound'));
          return;
        }

        console.log(
          '[text generation page] found target app:',
          targetApp.display_name
        );

        // Immediately set the sidebar selected state
        selectItem('app', instanceId);

        // Only switch when the current app does not match
        if (!currentAppMatches) {
          console.log(
            '[text generation page] need to switch app, from',
            currentAppId,
            'to',
            instanceId
          );

          try {
            await switchToSpecificApp(instanceId);
            console.log('[text generation page] app switched successfully');
          } catch (switchError) {
            console.warn(
              '[text generation page] app switching failed, but continue loading page:',
              switchError
            );
          }
        } else {
          console.log(
            '[text generation page] current app matched, no need to switch'
          );
        }

        console.log('[text generation page] app initialization completed');
      } catch (error) {
        console.error('[text generation page] initialization failed:', error);
        setInitError(
          error instanceof Error
            ? error.message
            : t('errors.initializationFailed')
        );
      } finally {
        setIsInitializing(false);
      }
    };

    if (instanceId) {
      initializeApp();
    }
  }, [
    instanceId,
    apps.length,
    currentAppId,
    fetchApps,
    switchToSpecificApp,
    selectItem,
    t,
  ]);

  // --- when page is unloaded, clear the selected state ---
  useEffect(() => {
    return () => {
      const currentPath = window.location.pathname;
      if (!currentPath.startsWith('/apps/')) {
        selectItem(null, null);
      }
    };
  }, [selectItem]);

  // --- error state ---
  if (initError) {
    return (
      <div className="relative flex h-full w-full flex-col items-center justify-center bg-stone-100 dark:bg-stone-800">
        <div className="text-center">
          <FileText
            className={cn(
              'mx-auto mb-4 h-16 w-16',
              'text-stone-500 dark:text-stone-400'
            )}
          />
          <h2
            className={cn(
              'mb-2 font-serif text-xl font-semibold',
              'text-stone-700 dark:text-stone-300'
            )}
          >
            {t('errors.appLoadFailed')}
          </h2>
          <p
            className={cn(
              'mb-4 font-serif',
              'text-stone-500 dark:text-stone-400'
            )}
          >
            {initError}
          </p>
          <button
            onClick={() => router.push('/apps')}
            className={cn(
              'rounded-lg px-4 py-2 font-serif transition-colors',
              'bg-stone-200 text-stone-800 hover:bg-stone-300',
              'dark:bg-stone-700 dark:text-stone-200 dark:hover:bg-stone-600'
            )}
          >
            {t('buttons.backToMarket')}
          </button>
        </div>
      </div>
    );
  }

  // --- loading state ---
  if (isInitializing || isValidating || !currentApp) {
    return (
      <div className="relative flex h-full w-full flex-col items-center justify-center bg-stone-100 dark:bg-stone-800">
        <div className="text-center">
          <Loader2
            className={cn(
              'mx-auto mb-4 h-8 w-8 animate-spin',
              'text-stone-500 dark:text-stone-400'
            )}
          />
          <p className={cn('font-serif', 'text-stone-500 dark:text-stone-400')}>
            {isInitializing
              ? t('status.loadingApp')
              : isValidating
                ? t('status.validatingConfig')
                : t('status.loading')}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col bg-stone-100 text-stone-900 dark:bg-stone-800 dark:text-gray-100">
      <div className="min-h-0 flex-1 pt-12">
        <TextGenerationLayout instanceId={instanceId} />
      </div>
    </div>
  );
}
