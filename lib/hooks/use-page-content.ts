'use client';

import type { PageContent } from '@lib/types/about-page-components';

import { useEffect, useState } from 'react';

import { useLocale } from 'next-intl';

interface CacheEntry {
  data: PageContent;
  timestamp: number;
}

interface UsePageContentOptions {
  page: 'home' | 'about';
  cacheTTL?: number;
  requestTimeoutMs?: number;
}

const pageContentCache = new Map<string, CacheEntry>();

export function clearPageContentCache(
  page?: 'home' | 'about',
  locale?: string
): void {
  if (!page && !locale) {
    pageContentCache.clear();
    return;
  }

  for (const key of pageContentCache.keys()) {
    if (page && !key.includes(`:${page}`)) {
      continue;
    }
    if (locale && !key.startsWith(`${locale}:`)) {
      continue;
    }
    pageContentCache.delete(key);
  }
}

export function usePageContent(options: UsePageContentOptions) {
  const { page, cacheTTL = 5 * 60 * 1000, requestTimeoutMs = 3000 } = options;
  const locale = useLocale();
  const [pageContent, setPageContent] = useState<PageContent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isCurrent = true;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, requestTimeoutMs);

    const loadPageContent = async () => {
      const cacheKey = `${locale}:${page}`;

      try {
        const cached = pageContentCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < cacheTTL) {
          if (isCurrent) {
            setPageContent(cached.data);
            setError(null);
            setIsLoading(false);
          }
          return;
        }

        const response = await fetch(
          `/api/content/pages/${page}?locale=${locale}`,
          {
            cache: 'no-store',
            signal: controller.signal,
          }
        );

        if (!response.ok) {
          throw new Error(`Failed to load content page: ${response.status}`);
        }

        const data = (await response.json()) as PageContent;
        pageContentCache.set(cacheKey, {
          data,
          timestamp: Date.now(),
        });

        if (isCurrent) {
          setPageContent(data);
          setError(null);
        }
      } catch (loadError) {
        if (isCurrent) {
          setPageContent(null);
          setError(
            loadError instanceof Error
              ? loadError.message
              : 'Failed to load content page'
          );
        }
      } finally {
        window.clearTimeout(timeoutId);
        if (isCurrent) {
          setIsLoading(false);
        }
      }
    };

    void loadPageContent();

    return () => {
      isCurrent = false;
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [cacheTTL, locale, page, requestTimeoutMs]);

  return { pageContent, isLoading, error };
}
