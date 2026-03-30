import {
  type SupportedLocale,
  getSupportedLocales,
  isValidLocale,
} from '@lib/config/language-config';
import { AppRequestError, extractAppErrorDetail } from '@lib/errors/app-error';

type TranslationData = Record<string, unknown>;

type PageName = 'about' | 'home';

type ContentPageResponse<TData = TranslationData> = {
  page: PageName;
  sourceLocale: SupportedLocale;
  structureVersion: number;
  supportedLocales: SupportedLocale[];
  translations: Record<SupportedLocale, TData>;
};

type ContentPageSaveResponse<TData = TranslationData> = {
  success: boolean;
  page: PageName;
  sourceLocale: SupportedLocale;
  structureVersion: number;
  updatedAt: string;
  translations: Record<SupportedLocale, TData>;
};

type TranslateAllResultItem = {
  locale: SupportedLocale;
  status: 'success' | 'failed';
  error?: string;
};

export interface TranslateAllRequest<TData = TranslationData> {
  section: 'pages.about' | 'pages.home';
  sourceLocale: SupportedLocale;
  sourceData: TData;
  basedOnStructureVersion: number;
  mode: 'overwrite';
}

export interface TranslateAllResult<TData = TranslationData> {
  success: boolean;
  page: PageName;
  sourceLocale: SupportedLocale;
  structureVersion: number;
  translatedAt: string;
  results: TranslateAllResultItem[];
  translations: Record<SupportedLocale, TData>;
}

function sectionToPage(section: 'pages.about' | 'pages.home'): PageName {
  return section === 'pages.about' ? 'about' : 'home';
}

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const detail = extractAppErrorDetail(payload);
    throw new AppRequestError(
      detail?.userMessage || `Request failed: ${response.statusText}`,
      response.status,
      detail
    );
  }

  return response.json() as Promise<T>;
}

export class ContentPageService {
  private static readonly API_BASE = '/api/admin/content/pages';

  static getSupportedLanguages(): SupportedLocale[] {
    return getSupportedLocales();
  }

  static isValidLanguage(locale: string): locale is SupportedLocale {
    return isValidLocale(locale);
  }

  private static async getPageTranslations<TData = TranslationData>(
    page: PageName
  ): Promise<ContentPageResponse<TData>> {
    const response = await fetch(`${this.API_BASE}/${page}`, {
      cache: 'no-store',
    });
    return parseJsonResponse<ContentPageResponse<TData>>(response);
  }

  private static async savePageStructure<TData = TranslationData>(
    page: PageName,
    content: TData,
    expectedStructureVersion: number
  ): Promise<ContentPageSaveResponse<TData>> {
    const response = await fetch(`${this.API_BASE}/${page}/structure`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content, expectedStructureVersion }),
    });

    return parseJsonResponse<ContentPageSaveResponse<TData>>(response);
  }

  private static async savePageLocale<TData = TranslationData>(
    page: PageName,
    locale: SupportedLocale,
    content: TData,
    basedOnStructureVersion: number
  ): Promise<ContentPageSaveResponse<TData>> {
    const response = await fetch(`${this.API_BASE}/${page}/locales/${locale}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content, basedOnStructureVersion }),
    });

    return parseJsonResponse<ContentPageSaveResponse<TData>>(response);
  }

  static async getAboutPageTranslations<TData = TranslationData>(): Promise<
    ContentPageResponse<TData>
  > {
    return this.getPageTranslations<TData>('about');
  }

  static async updateAboutPageStructure<TData = TranslationData>(
    content: TData,
    expectedStructureVersion: number
  ): Promise<ContentPageSaveResponse<TData>> {
    return this.savePageStructure<TData>(
      'about',
      content,
      expectedStructureVersion
    );
  }

  static async updateAboutPageLocale<TData = TranslationData>(
    locale: SupportedLocale,
    content: TData,
    basedOnStructureVersion: number
  ): Promise<ContentPageSaveResponse<TData>> {
    return this.savePageLocale<TData>(
      'about',
      locale,
      content,
      basedOnStructureVersion
    );
  }

  static async getHomePageTranslations<TData = TranslationData>(): Promise<
    ContentPageResponse<TData>
  > {
    return this.getPageTranslations<TData>('home');
  }

  static async updateHomePageStructure<TData = TranslationData>(
    content: TData,
    expectedStructureVersion: number
  ): Promise<ContentPageSaveResponse<TData>> {
    return this.savePageStructure<TData>(
      'home',
      content,
      expectedStructureVersion
    );
  }

  static async updateHomePageLocale<TData = TranslationData>(
    locale: SupportedLocale,
    content: TData,
    basedOnStructureVersion: number
  ): Promise<ContentPageSaveResponse<TData>> {
    return this.savePageLocale<TData>(
      'home',
      locale,
      content,
      basedOnStructureVersion
    );
  }

  static async translateAllPageTranslations<TData = TranslationData>(
    request: TranslateAllRequest<TData>
  ): Promise<TranslateAllResult<TData>> {
    const page = sectionToPage(request.section);
    const response = await fetch(`${this.API_BASE}/${page}/translate-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sourceLocale: request.sourceLocale,
        sourceData: request.sourceData,
        basedOnStructureVersion: request.basedOnStructureVersion,
        mode: request.mode,
      }),
    });

    return parseJsonResponse<TranslateAllResult<TData>>(response);
  }
}

export { ContentPageService as TranslationService };
