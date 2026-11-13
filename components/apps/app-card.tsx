'use client';

import { useFavoriteAppsStore } from '@lib/stores/favorite-apps-store';
import { getDifyAppTypeInfo } from '@lib/types/dify-app-types';
import { cn } from '@lib/utils';
import { ArrowRight, Blocks, Cpu, Heart } from 'lucide-react';

import React from 'react';

import { useTranslations } from 'next-intl';
import Image from 'next/image';

interface AppInstance {
  instanceId: string;
  displayName: string;
  description?: string;
  appType: 'model' | 'marketplace';
  iconUrl?: string;
  category?: string;
  tags?: string[];
  difyAppType?: string;
  isPopular?: boolean;
  lastUsed?: string;
  config?: {
    app_metadata?: {
      dify_apptype?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
}

interface AppCardProps {
  app: AppInstance;
  viewMode: 'grid' | 'list';
  onClick: (app: AppInstance) => void;
}

export function AppCard({ app, viewMode, onClick }: AppCardProps) {
  const { addFavoriteApp, removeFavoriteApp, isFavorite } =
    useFavoriteAppsStore();
  const t = useTranslations('pages.apps.market');
  const tDifyTypes = useTranslations('difyAppTypes');

  const isLangChain = app.config?.backend_type === 'langchain';
  const difyAppType = isLangChain
    ? undefined
    : app.config?.app_metadata?.dify_apptype || app.difyAppType;
  const difyTypeInfo = difyAppType
    ? getDifyAppTypeInfo(difyAppType, tDifyTypes)
    : null;

  const isAppFavorite = isFavorite(app.instanceId);

  const handleToggleFavorite = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (isAppFavorite) {
      removeFavoriteApp(app.instanceId);
    } else {
      await addFavoriteApp({
        ...(app.config?.backend_type === 'langchain'
          ? {
              backendType: 'langchain' as const,
              serviceInstanceId: app.instanceId,
            }
          : {}),
        instanceId: app.instanceId,
        displayName: app.displayName,
        description: app.description,
        iconUrl: app.iconUrl,
        appType: app.appType,
        dify_apptype: difyAppType as
          | 'agent'
          | 'chatbot'
          | 'text-generation'
          | 'chatflow'
          | 'workflow'
          | undefined,
      });
    }
  };

  const getAppIcon = (app: AppInstance) => {
    if (app.iconUrl) {
      return (
        <Image
          src={app.iconUrl}
          alt={app.displayName}
          width={32}
          height={32}
          className="h-8 w-8 rounded-full object-cover"
        />
      );
    }
    const getIconColors = () => {
      if (difyTypeInfo) {
        switch (difyAppType) {
          case 'chatbot':
            return 'bg-gradient-to-br from-blue-400 to-blue-500 dark:from-blue-500 dark:to-blue-600';
          case 'agent':
            return 'bg-gradient-to-br from-purple-400 to-purple-500 dark:from-purple-500 dark:to-purple-600';
          case 'workflow':
            return 'bg-gradient-to-br from-green-400 to-green-500 dark:from-green-500 dark:to-green-600';
          case 'text-generation':
            return 'bg-gradient-to-br from-orange-400 to-orange-500 dark:from-orange-500 dark:to-orange-600';
          case 'chatflow':
            return 'bg-gradient-to-br from-teal-400 to-teal-500 dark:from-teal-500 dark:to-teal-600';
          default:
            return 'bg-gradient-to-br from-stone-400 to-stone-500 dark:from-stone-600 dark:to-stone-700';
        }
      }

      return app.appType === 'model'
        ? 'bg-gradient-to-br from-stone-400 to-stone-500 dark:from-stone-600 dark:to-stone-700'
        : 'bg-gradient-to-br from-stone-300 to-stone-400 dark:from-stone-500 dark:to-stone-600';
    };

    return (
      <div
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-full text-white shadow-sm',
          getIconColors()
        )}
      >
        {difyTypeInfo ? (
          <span className="text-sm">{difyTypeInfo.icon}</span>
        ) : app.appType === 'model' ? (
          <Cpu className="h-4 w-4" />
        ) : (
          <Blocks className="h-4 w-4" />
        )}
      </div>
    );
  };

  return (
    <div
      onClick={() => onClick(app)}
      className={cn(
        'group relative cursor-pointer transition-all duration-200',
        'rounded-lg border bg-white',
        'hover:-translate-y-0.5 hover:shadow-md',
        'border-stone-200 bg-white',
        'hover:border-stone-300 hover:shadow-stone-200/30',
        'dark:border-stone-700 dark:bg-stone-900',
        'dark:hover:border-stone-600 dark:hover:shadow-stone-950/30',
        viewMode === 'list' && 'flex items-center gap-3 p-3'
      )}
    >
      {viewMode === 'grid' ? (
        <div className="flex h-full flex-col p-4">
          <button
            onClick={handleToggleFavorite}
            className={cn(
              'absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full',
              'opacity-0 transition-all duration-200 group-hover:opacity-100',
              'hover:scale-110',
              isAppFavorite
                ? 'bg-red-100 text-red-500 opacity-100 dark:bg-red-900/30 dark:text-red-400'
                : 'bg-stone-100 text-stone-400 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-500 dark:hover:bg-stone-700'
            )}
          >
            <Heart
              className={cn(
                'h-3 w-3 transition-transform',
                isAppFavorite && 'scale-110 fill-current'
              )}
            />
          </button>

          <div className="mb-2 flex items-center gap-3">
            {getAppIcon(app)}
            <h3
              className={cn(
                'line-clamp-1 flex-1 font-serif text-sm font-semibold',
                'text-stone-900 dark:text-gray-100'
              )}
            >
              {app.displayName}
            </h3>
          </div>

          <div className="mb-3 flex-1">
            <p
              className={cn(
                'line-clamp-2 font-serif text-xs leading-relaxed',
                'text-stone-600 dark:text-stone-400'
              )}
            >
              {app.description || t('appCard.noDescription')}
            </p>
          </div>

          <div className="mt-auto flex items-center justify-between text-xs">
            <span className={cn('font-serif', 'text-stone-500')}>
              {isLangChain
                ? 'LangChain'
                : difyTypeInfo?.label || t('appCard.defaultType')}
            </span>

            <ArrowRight className={cn('h-3 w-3', 'text-stone-500')} />
          </div>
        </div>
      ) : (
        <>
          <div className="flex-shrink-0">{getAppIcon(app)}</div>

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <h3
                className={cn(
                  'font-serif text-sm font-semibold',
                  'text-stone-900 dark:text-gray-100'
                )}
              >
                {app.displayName}
              </h3>

              {(isLangChain || difyTypeInfo) && (
                <span
                  className={cn(
                    'rounded px-1.5 py-0.5 font-serif text-xs',
                    'bg-stone-100 text-stone-600 dark:bg-stone-800 dark:text-stone-300'
                  )}
                >
                  {isLangChain ? 'LangChain' : difyTypeInfo?.label}
                </span>
              )}
            </div>

            <p
              className={cn(
                'line-clamp-1 font-serif text-xs',
                'text-stone-600 dark:text-stone-400'
              )}
            >
              {app.description || t('appCard.noDescription')}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleToggleFavorite}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full',
                'transition-all duration-200',
                isAppFavorite
                  ? 'bg-red-100 text-red-500 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-stone-100 text-stone-400 opacity-0 group-hover:opacity-100 hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-500 dark:hover:bg-stone-700'
              )}
            >
              <Heart
                className={cn(
                  'h-3 w-3 transition-transform',
                  isAppFavorite && 'fill-current'
                )}
              />
            </button>

            <ArrowRight
              className={cn('h-4 w-4', 'text-stone-500 dark:text-stone-400')}
            />
          </div>
        </>
      )}
    </div>
  );
}
