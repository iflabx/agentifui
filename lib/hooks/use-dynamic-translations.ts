/**
 * Dynamic Translation Hook
 * Provides real-time translation loading with intelligent caching for admin-managed content
 * @module lib/hooks/use-dynamic-translations
 */
import { useCallback, useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

/**
 * Cache entry for translation data
 * Contains translation data and timestamp for TTL validation
 */
interface CacheEntry {
  data: Record<string, unknown>; // Translation data object
  timestamp: number; // Cache creation timestamp in milliseconds
}

/**
 * Configuration for the dynamic translation hook
 * Specifies which sections to load and cache settings
 */
interface UseDynamicTranslationsConfig {
  sections: string[]; // Translation sections to load (e.g., ['pages.about', 'pages.home'])
  cacheTTL?: number; // Cache TTL in milliseconds (default: 5 minutes)
}

// In-memory cache for translation data to avoid redundant API calls
const translationCache = new Map<string, CacheEntry>();

/**
 * Clear translation cache for a specific locale or all locales
 * Used by admin interface to force refresh after translation updates
 * @param locale - Specific locale to clear, or undefined to clear all
 */
export function clearTranslationCache(locale?: string): void {
  if (locale) {
    // Remove cache entries for the specified locale
    for (const key of translationCache.keys()) {
      if (key.startsWith(`${locale}_`)) {
        translationCache.delete(key);
      }
    }
  } else {
    // Remove all cache entries
    translationCache.clear();
  }
}

/**
 * Hook for loading dynamic translations with caching
 * Loads real-time translations from API with fallback to static translations
 * @param config - Configuration object specifying sections and cache settings
 * @returns Object containing translation function and loading state
 */
export function useDynamicTranslations(config: UseDynamicTranslationsConfig) {
  const { sections, cacheTTL = 5 * 60 * 1000 } = config;
  const [dynamicData, setDynamicData] = useState<Record<
    string,
    unknown
  > | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const staticT = useTranslations(); // Fallback to static translations

  useEffect(() => {
    let isCurrent = true;

    const loadDynamicTranslations = async () => {
      try {
        const locale = document.documentElement.lang || 'en-US';
        const cacheKey = `${locale}_${sections.join(',')}`;

        // Check in-memory cache first
        const cached = translationCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < cacheTTL) {
          if (isCurrent) {
            setDynamicData(cached.data);
            setIsLoading(false);
          }
          return;
        }

        // Fetch from API if not cached or cache expired
        const response = await fetch(
          `/api/translations/${locale}?sections=${sections.join(',')}`
        );

        if (response.ok) {
          const data = await response.json();

          // Update cache with new data
          translationCache.set(cacheKey, {
            data,
            timestamp: Date.now(),
          });

          if (isCurrent) {
            setDynamicData(data);
            setIsLoading(false);
          }
        } else {
          // API failed, fallback to static translations
          console.warn('Dynamic translation API failed, using static fallback');
          if (isCurrent) {
            setDynamicData(null);
            setIsLoading(false);
          }
        }
      } catch (error) {
        console.error('Failed to load dynamic translations:', error);
        if (isCurrent) {
          setDynamicData(null);
          setIsLoading(false);
        }
      }
    };

    loadDynamicTranslations();

    // Cleanup to prevent state updates on unmounted component
    return () => {
      isCurrent = false;
    };
  }, [sections.join(','), cacheTTL]);

  /**
   * Translation function with dynamic/static fallback
   * Returns dynamic translation if available, otherwise falls back to static
   * @param key - Translation key (e.g., 'title', 'subtitle')
   * @param section - Section prefix (e.g., 'pages.about')
   * @param params - Optional parameters for translation interpolation
   * @returns Translated string
   */
  const t = useCallback(
    <T = string>(
      key: string,
      section: string,
      params?: Record<string, string | number | Date>
    ): T => {
      // Try dynamic translation first
      if (dynamicData) {
        const dynamicValue = getNestedValue(dynamicData, `${section}.${key}`);
        if (dynamicValue !== undefined && dynamicValue !== null) {
          // Substitute parameters if needed
          if (params && typeof dynamicValue === 'string') {
            return interpolateString(dynamicValue, params) as T;
          }
          return dynamicValue as T;
        }
      }
      // Fallback to static translation
      return staticT(`${section}.${key}`, params) as T;
    },
    [dynamicData, staticT]
  );

  return { t, isLoading };
}

/**
 * Get nested value from object using dot notation
 * @param obj - Source object
 * @param path - Dot-separated path (e.g., 'pages.about.title')
 * @returns Value at path or undefined if not found
 */
function getNestedValue(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return (current as Record<string, unknown>)[key];
  }, obj);
}

/**
 * Interpolate parameters into a string template
 * Replaces {param} placeholders with actual values
 * @param template - String template with {param} placeholders
 * @param params - Object containing parameter values
 * @returns Interpolated string
 */
function interpolateString(
  template: string,
  params: Record<string, string | number | Date>
): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return params[key] !== undefined ? String(params[key]) : match;
  });
}
