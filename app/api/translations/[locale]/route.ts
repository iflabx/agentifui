/**
 * Dynamic Translation API
 * @description Serves real-time translations for about/home pages without requiring rebuild
 * @module app/api/translations/dynamic/[locale]
 */
import { isValidLocale } from '@lib/config/language-config';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';
import { promises as fs } from 'fs';
import path from 'path';

import { NextRequest, NextResponse } from 'next/server';

/**
 * File cache entry structure
 * @description Contains parsed translation data and file modification time for cache validation
 */
interface FileCacheEntry {
  /** Parsed JSON translation data */
  data: Record<string, unknown>;
  /** File modification time in milliseconds */
  mtime: number;
}

// In-memory file cache to avoid repeated disk reads
const fileCache = new Map<string, FileCacheEntry>();

/**
 * Get dynamic translations for specific locale and sections
 * @description Returns real-time translation data from JSON files with intelligent caching
 *
 * @param request - Next.js request object
 * @param params - Route parameters containing locale
 * @returns JSON response with translation data
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ locale: string }> }
) {
  const { locale } = await params;
  const { searchParams } = new URL(request.url);
  const sections = searchParams.get('sections')?.split(',') || [
    'pages.about',
    'pages.home',
  ];

  if (!isValidLocale(locale)) {
    return nextApiErrorResponse({
      request,
      status: 400,
      code: 'I18N_LOCALE_INVALID',
      userMessage: 'Invalid locale',
    });
  }

  try {
    const filePath = path.join(process.cwd(), 'messages', `${locale}.json`);
    const stats = await fs.stat(filePath);
    const cacheKey = `${locale}_${stats.mtimeMs}`;

    // Check if file content is cached and up-to-date
    let fileContent = fileCache.get(cacheKey);
    if (!fileContent || fileContent.mtime !== stats.mtimeMs) {
      const content = await fs.readFile(filePath, 'utf-8');
      fileContent = { data: JSON.parse(content), mtime: stats.mtimeMs };
      fileCache.set(cacheKey, fileContent);

      // Prevent memory bloat by cleaning old cache entries
      if (fileCache.size > 20) {
        const oldestKey = fileCache.keys().next().value;
        if (oldestKey) {
          fileCache.delete(oldestKey);
        }
      }
    }

    // Extract only requested sections to minimize payload size
    const result: Record<string, unknown> = {};
    sections.forEach(section => {
      const sectionData = getSectionData(fileContent.data, section);
      if (sectionData) {
        setNestedValue(result, section, sectionData);
      }
    });

    return NextResponse.json(result, {
      headers: {
        'Cache-Control': 'public, max-age=60, s-maxage=300',
        ETag: `"${locale}-${sections.join(',')}-${stats.mtimeMs}"`,
      },
    });
  } catch (error) {
    console.error('Dynamic translation API error:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      code: 'I18N_TRANSLATIONS_LOAD_FAILED',
      userMessage: 'Failed to load dynamic translations',
      developerMessage:
        error instanceof Error
          ? error.message
          : 'Unknown translations API error',
      extra: {},
    });
  }
}

/**
 * Extract nested data from object using dot notation path
 * @description Safely navigates nested object structure to retrieve specific section data
 *
 * @param data - Source object to extract from
 * @param section - Dot-separated path (e.g., 'pages.about')
 * @returns Extracted data or undefined if path doesn't exist
 */
function getSectionData(
  data: Record<string, unknown>,
  section: string
): unknown {
  return section.split('.').reduce((current, key) => {
    if (current && typeof current === 'object' && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, data as unknown);
}

/**
 * Set nested value in object using dot notation path
 * @description Creates nested object structure and sets value at specified path
 *
 * @param obj - Target object to modify
 * @param path - Dot-separated path where to set the value
 * @param value - Value to set at the specified path
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const keys = path.split('.');
  const lastKey = keys.pop()!;
  const target = keys.reduce((current: Record<string, unknown>, key) => {
    if (!current[key]) {
      current[key] = {};
    }
    return current[key] as Record<string, unknown>;
  }, obj);
  (target as Record<string, unknown>)[lastKey] = value;
}
