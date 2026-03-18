'use client';

import { AppFilters, AppHeader, AppList, AppLoading } from '@components/apps';
import type { AppInstance } from '@components/apps/types';
import { useAppListStore } from '@lib/stores/app-list-store';
import { useFavoriteAppsStore } from '@lib/stores/favorite-apps-store';
import { useSidebarStore } from '@lib/stores/sidebar-store';
import { cn } from '@lib/utils';

import { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';

export default function AppsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { favoriteApps } = useFavoriteAppsStore();
  const { selectItem } = useSidebarStore();
  const t = useTranslations('pages.apps.market');
  const { apps: rawApps, fetchApps, isLoading } = useAppListStore();

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(
    t('categoryKeys.all')
  );
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  useEffect(() => {
    fetchApps();
  }, [fetchApps]);

  useEffect(() => {
    selectItem(null, null);
  }, [selectItem]);

  useEffect(() => {
    const categoryParam = searchParams.get('category');
    const searchParam = searchParams.get('search');

    if (categoryParam) {
      setSelectedCategory(decodeURIComponent(categoryParam));
    }

    if (searchParam) {
      setSearchTerm(decodeURIComponent(searchParam));
    }
  }, [searchParams]);

  const updateURLParams = (category?: string, search?: string) => {
    const params = new URLSearchParams();

    if (category && category !== t('categoryKeys.all')) {
      params.set('category', encodeURIComponent(category));
    }

    if (search && search.trim()) {
      params.set('search', encodeURIComponent(search.trim()));
    }

    const queryString = params.toString();
    const newURL = queryString ? `/apps?${queryString}` : '/apps';

    router.replace(newURL, { scroll: false });
  };

  const handleCategoryChange = (category: string) => {
    setSelectedCategory(category);
    updateURLParams(category, searchTerm);
  };

  const handleSearchChange = (search: string) => {
    setSearchTerm(search);
    updateURLParams(selectedCategory, search);
  };

  const apps: AppInstance[] = rawApps
    .filter(app => {
      const metadata = app.config?.app_metadata;

      if (metadata) {
        return (
          metadata.app_type === 'marketplace' ||
          metadata.is_marketplace_app === true
        );
      }

      return false;
    })
    .map(app => {
      const metadata = app.config?.app_metadata;
      const difyParams = app.config?.dify_parameters;

      const difyAppType = metadata?.dify_apptype;

      let description =
        metadata?.brief_description ||
        app.description ||
        difyParams?.opening_statement;

      if (!description) {
        description = t('appCard.noDescription');
      }

      return {
        instanceId: app.instance_id,
        displayName: app.display_name || app.instance_id,
        description,
        appType: 'marketplace' as const,
        iconUrl: metadata?.icon_url,
        difyAppType: difyAppType,
        tags: metadata?.tags || [],
        isPopular: metadata?.is_common_model || false,
        lastUsed: new Date().toISOString().split('T')[0],
        config: app.config,
      };
    });

  const hasCommonApps = apps.some(app => {
    const isFavorite = favoriteApps.some(
      fav => fav.instanceId === app.instanceId
    );
    return app.isPopular || isFavorite;
  });

  const extractTagCategories = (apps: AppInstance[]): string[] => {
    const tagCounts = new Map<string, number>();

    // count the usage frequency of each tag
    apps.forEach(app => {
      if (app.tags && app.tags.length > 0) {
        app.tags.forEach(tag => {
          if (tag && tag.trim()) {
            const normalizedTag = tag.trim();
            tagCounts.set(
              normalizedTag,
              (tagCounts.get(normalizedTag) || 0) + 1
            );
          }
        });
      }
    });

    // sort by usage frequency in descending order, if frequency is the same, sort by alphabetical order
    return Array.from(tagCounts.entries())
      .sort(([tagA, countA], [tagB, countB]) => {
        if (countA !== countB) {
          return countB - countA; // sort by usage frequency in descending order
        }
        return tagA.localeCompare(tagB); // sort by alphabetical order
      })
      .map(([tag]) => tag);
  };

  const tagCategories = extractTagCategories(apps);

  const categories = [
    t('categoryKeys.all'), // "all" category
    ...(hasCommonApps ? [t('categoryKeys.commonApps')] : []), // "common apps" category (if any)
    ...tagCategories, // dynamic tag category
  ];

  const filteredApps = apps.filter(app => {
    const matchesSearch =
      app.displayName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.description?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      app.tags?.some(tag =>
        tag.toLowerCase().includes(searchTerm.toLowerCase())
      );

    let matchesCategory = false;

    if (selectedCategory === t('categoryKeys.all')) {
      matchesCategory = true;
    } else if (selectedCategory === t('categoryKeys.commonApps')) {
      const isFavorite = favoriteApps.some(
        fav => fav.instanceId === app.instanceId
      );
      matchesCategory = app.isPopular || isFavorite;
    } else {
      const appTags = app.tags || [];
      matchesCategory = appTags.includes(selectedCategory);
    }

    return matchesSearch && matchesCategory;
  });

  const sortedApps = [...filteredApps].sort((a, b) => {
    const aIsFavorite = favoriteApps.some(
      fav => fav.instanceId === a.instanceId
    );
    const bIsFavorite = favoriteApps.some(
      fav => fav.instanceId === b.instanceId
    );

    if (aIsFavorite && !bIsFavorite) return -1;
    if (!aIsFavorite && bIsFavorite) return 1;

    return a.displayName.localeCompare(b.displayName);
  });

  const handleOpenApp = async (app: AppInstance) => {
    try {
      const difyAppType = app.config?.app_metadata?.dify_apptype;

      let routePath: string;

      switch (difyAppType) {
        case 'chatbot':
          routePath = `/apps/chatbot/${app.instanceId}`;
          break;
        case 'agent':
          routePath = `/apps/agent/${app.instanceId}`;
          break;
        case 'chatflow':
          routePath = `/apps/chatflow/${app.instanceId}`;
          break;
        case 'workflow':
          routePath = `/apps/workflow/${app.instanceId}`;
          break;
        case 'text-generation':
          routePath = `/apps/text-generation/${app.instanceId}`;
          break;
        default:
          console.warn(
            `${t('unknownAppType')}: ${difyAppType}，${t('useDefaultRoute')}`
          );
          routePath = `/apps/chatbot/${app.instanceId}`;
      }

      console.log(
        `[${t('routeJump')}] ${t('app')}: ${app.displayName}, ${t('type')}: ${difyAppType}, ${t('path')}: ${routePath}`
      );

      router.push(routePath);
    } catch (error) {
      console.error(`${t('openAppFailed')}:`, error);
    }
  };

  if (isLoading) {
    return <AppLoading />;
  }

  return (
    <>
      <div
        className={cn(
          'bg-stone-100 dark:bg-stone-800',
          'min-h-screen',
          'pt-16 md:pt-12'
        )}
      >
        <div className="mx-auto max-w-6xl px-4 py-8">
          <AppHeader
            totalApps={apps.length}
            filteredApps={sortedApps.length}
            selectedCategory={selectedCategory}
          />

          <AppFilters
            searchTerm={searchTerm}
            onSearchChange={handleSearchChange}
            selectedCategory={selectedCategory}
            onCategoryChange={handleCategoryChange}
            categories={categories}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
          />

          <AppList
            apps={sortedApps}
            viewMode={viewMode}
            onAppClick={handleOpenApp}
          />
        </div>
      </div>
    </>
  );
}
