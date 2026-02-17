import {
  type SupportedLocale,
  getSupportedLocales,
  isValidLocale,
} from '@lib/config/language-config';

type TranslationData = Record<string, unknown>;

// translation service interface
export interface TranslationResponse<TData = TranslationData> {
  locale: string;
  section?: string;
  data: TData;
}

export interface UpdateTranslationRequest<TData = TranslationData> {
  locale: SupportedLocale;
  section?: string;
  updates: TData;
  mode?: 'merge' | 'replace';
}

export interface BatchUpdateRequest<TData = TranslationData> {
  section: string;
  updates: Record<SupportedLocale, TData>;
  mode?: 'merge' | 'replace';
}

export interface TranslationUpdateResult {
  success: boolean;
  locale: string;
  section: string;
  mode: string;
  updatedAt: string;
}

export interface BatchUpdateResult {
  success: boolean;
  section: string;
  mode: string;
  results: Array<{ locale: string; success: boolean; updatedAt: string }>;
  errors: Array<{ locale: string; error: string }>;
  totalProcessed: number;
  totalErrors: number;
}

// translation management service class
export class TranslationService {
  private static readonly API_BASE = '/api/admin/translations';

  // get supported languages list
  static getSupportedLanguages(): SupportedLocale[] {
    return getSupportedLocales();
  }

  // validate language code
  static isValidLanguage(locale: string): locale is SupportedLocale {
    return isValidLocale(locale);
  }

  // get all supported languages information
  static async getLanguageMetadata(): Promise<{
    supportedLocales: SupportedLocale[];
    availableLanguages: number;
    lastModified: string;
  }> {
    const response = await fetch(this.API_BASE);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch language metadata: ${response.statusText}`
      );
    }
    return response.json();
  }

  // read translations for a specific language
  static async getTranslations<TData = TranslationData>(
    locale: SupportedLocale,
    section?: string
  ): Promise<TranslationResponse<TData>> {
    const params = new URLSearchParams({ locale });
    if (section) {
      params.append('section', section);
    }

    const response = await fetch(`${this.API_BASE}?${params}`);
    if (!response.ok) {
      throw new Error(
        `Failed to fetch translations for ${locale}: ${response.statusText}`
      );
    }
    return response.json();
  }

  // get all translations for a specific section
  static async getAllTranslationsForSection<TData = TranslationData>(
    section: string
  ): Promise<Record<SupportedLocale, TData>> {
    const locales = this.getSupportedLanguages();
    const results = {} as Record<SupportedLocale, TData>;

    await Promise.all(
      locales.map(async locale => {
        try {
          const response = await this.getTranslations<TData>(locale, section);
          results[locale] = response.data;
        } catch (error) {
          console.warn(`Failed to load ${section} for ${locale}:`, error);
          results[locale] = {} as TData;
        }
      })
    );

    return results;
  }

  // update translation for a specific language
  static async updateTranslation<TData = TranslationData>(
    request: UpdateTranslationRequest<TData>
  ): Promise<TranslationUpdateResult> {
    const response = await fetch(this.API_BASE, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error || `Failed to update translation: ${response.statusText}`
      );
    }

    return response.json();
  }

  // batch update translations for multiple languages
  static async batchUpdateTranslations<TData = TranslationData>(
    request: BatchUpdateRequest<TData>
  ): Promise<BatchUpdateResult> {
    const response = await fetch(this.API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(
        error.error ||
          `Failed to batch update translations: ${response.statusText}`
      );
    }

    return response.json();
  }

  // get translations for About page
  static async getAboutPageTranslations<TData = TranslationData>(): Promise<
    Record<SupportedLocale, TData>
  > {
    return this.getAllTranslationsForSection<TData>('pages.about');
  }

  // update translations for About page
  static async updateAboutPageTranslations<TData = TranslationData>(
    updates: Record<SupportedLocale, TData>,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<BatchUpdateResult> {
    return this.batchUpdateTranslations<TData>({
      section: 'pages.about',
      updates,
      mode,
    });
  }

  // get translations for Home page
  static async getHomePageTranslations<TData = TranslationData>(): Promise<
    Record<SupportedLocale, TData>
  > {
    return this.getAllTranslationsForSection<TData>('pages.home');
  }

  // update translations for Home page
  static async updateHomePageTranslations<TData = TranslationData>(
    updates: Record<SupportedLocale, TData>,
    mode: 'merge' | 'replace' = 'merge'
  ): Promise<BatchUpdateResult> {
    return this.batchUpdateTranslations<TData>({
      section: 'pages.home',
      updates,
      mode,
    });
  }

  // get translation structure template for a specific section (for admin interface initialization)
  static async getTranslationTemplate(
    section: string,
    baseLocale: SupportedLocale = 'zh-CN'
  ): Promise<TranslationData> {
    try {
      const response = await this.getTranslations(baseLocale, section);
      return response.data;
    } catch (error) {
      console.warn(`Failed to get template for ${section}:`, error);
      return {};
    }
  }

  // validate translation data structure completeness
  static validateTranslationStructure(
    template: unknown,
    data: unknown,
    path: string = ''
  ): { isValid: boolean; missingKeys: string[]; extraKeys: string[] } {
    const missingKeys: string[] = [];
    const extraKeys: string[] = [];

    // check if all keys in template exist in data
    if (template && typeof template === 'object' && !Array.isArray(template)) {
      const templateRecord = template as Record<string, unknown>;
      const dataRecord =
        data && typeof data === 'object' && !Array.isArray(data)
          ? (data as Record<string, unknown>)
          : {};

      for (const key in templateRecord) {
        const currentPath = path ? `${path}.${key}` : key;

        if (!(key in dataRecord)) {
          missingKeys.push(currentPath);
        } else if (
          typeof templateRecord[key] === 'object' &&
          templateRecord[key] !== null &&
          !Array.isArray(templateRecord[key])
        ) {
          // recursively check nested objects
          const nested = this.validateTranslationStructure(
            templateRecord[key],
            dataRecord[key],
            currentPath
          );
          missingKeys.push(...nested.missingKeys);
          extraKeys.push(...nested.extraKeys);
        }
      }
    }

    // check if there are keys in data that do not exist in template
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const dataRecord = data as Record<string, unknown>;
      const templateRecord =
        template && typeof template === 'object' && !Array.isArray(template)
          ? (template as Record<string, unknown>)
          : null;

      for (const key in dataRecord) {
        const currentPath = path ? `${path}.${key}` : key;

        if (!templateRecord || !(key in templateRecord)) {
          extraKeys.push(currentPath);
        }
      }
    }

    return {
      isValid: missingKeys.length === 0 && extraKeys.length === 0,
      missingKeys,
      extraKeys,
    };
  }

  // create translation backup (before update)
  static async createBackup(section: string): Promise<{
    timestamp: string;
    data: Record<SupportedLocale, TranslationData>;
  }> {
    const timestamp = new Date().toISOString();
    const data = await this.getAllTranslationsForSection(section);

    // here you can choose to store in localStorage or send to backend storage
    const backupKey = `translation_backup_${section}_${timestamp}`;
    localStorage.setItem(backupKey, JSON.stringify({ timestamp, data }));

    return { timestamp, data };
  }

  // restore translation backup
  static async restoreFromBackup(
    section: string,
    timestamp: string
  ): Promise<BatchUpdateResult> {
    const backupKey = `translation_backup_${section}_${timestamp}`;
    const backupData = localStorage.getItem(backupKey);

    if (!backupData) {
      throw new Error(`Backup not found for ${section} at ${timestamp}`);
    }

    const { data } = JSON.parse(backupData);

    return this.batchUpdateTranslations({
      section,
      updates: data,
      mode: 'replace',
    });
  }
}
