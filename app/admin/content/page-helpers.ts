import type { SupportedLocale } from '@lib/config/language-config';
import type {
  AboutTranslationData,
  PageContent,
} from '@lib/types/about-page-components';
import {
  isDynamicFormat,
  migrateAboutTranslationData,
} from '@lib/types/about-page-components';
import type { HomeTranslationData } from '@lib/utils/data-migration';
import {
  isHomeDynamicFormat,
  migrateHomeTranslationData,
} from '@lib/utils/data-migration';

export interface FeatureCard {
  title: string;
  description: string;
}

export interface HomePageConfig {
  title: string;
  subtitle: string;
  getStarted: string;
  learnMore: string;
  features: FeatureCard[];
  copyright: {
    prefix: string;
    linkText: string;
    suffix: string;
  };
}

function getMetadataFallback(): PageContent['metadata'] {
  return {
    version: '1.0.0',
    lastModified: new Date().toISOString(),
    author: 'admin',
  };
}

export function createPageContentFromAboutTranslation(
  translation: AboutTranslationData
): PageContent | null {
  const dynamicTranslation = isDynamicFormat(translation)
    ? translation
    : migrateAboutTranslationData(translation);

  if (!dynamicTranslation.sections) {
    return null;
  }

  return {
    sections: dynamicTranslation.sections,
    metadata: dynamicTranslation.metadata || getMetadataFallback(),
  };
}

export function createPageContentFromHomeTranslation(
  translation: HomeTranslationData
): PageContent | null {
  const dynamicTranslation = isHomeDynamicFormat(translation)
    ? translation
    : migrateHomeTranslationData(translation);

  if (!dynamicTranslation.sections) {
    return null;
  }

  return {
    sections: dynamicTranslation.sections,
    metadata: dynamicTranslation.metadata || getMetadataFallback(),
  };
}

export function collectAllSections(
  translations: Record<string, AboutTranslationData | HomeTranslationData>,
  isHome: boolean = false
): PageContent['sections'] {
  return Object.values(translations).flatMap(translation => {
    const content = isHome
      ? createPageContentFromHomeTranslation(translation as HomeTranslationData)
      : createPageContentFromAboutTranslation(
          translation as AboutTranslationData
        );

    return content?.sections || [];
  });
}

export function convertHomeTranslationsToAboutTranslations(
  translations: Record<SupportedLocale, HomeTranslationData> | null
): Record<SupportedLocale, AboutTranslationData> | null {
  if (!translations) {
    return null;
  }

  return Object.fromEntries(
    Object.entries(translations).map(([locale, translation]) => [
      locale,
      isHomeDynamicFormat(translation)
        ? translation
        : migrateHomeTranslationData(translation),
    ])
  ) as Record<SupportedLocale, AboutTranslationData>;
}

export function convertAboutTranslationsToHomeTranslations(
  translations: Record<SupportedLocale, AboutTranslationData>
): Record<SupportedLocale, HomeTranslationData> {
  return Object.fromEntries(
    Object.entries(translations).map(([locale, translation]) => [
      locale,
      translation as HomeTranslationData,
    ])
  ) as Record<SupportedLocale, HomeTranslationData>;
}

export function transformToHomePreviewConfig(
  translations: Record<SupportedLocale, HomeTranslationData> | null,
  locale: SupportedLocale
): HomePageConfig | null {
  const translation = translations?.[locale];
  if (!translation) {
    return null;
  }

  return {
    title: translation.title || '',
    subtitle: translation.subtitle || '',
    getStarted: translation.getStarted || '',
    learnMore: translation.learnMore || '',
    features: translation.features || [],
    copyright: translation.copyright
      ? {
          prefix: translation.copyright.prefix || '',
          linkText: translation.copyright.linkText || '',
          suffix: translation.copyright.suffix || '',
        }
      : { prefix: '', linkText: '', suffix: '' },
  };
}
