import type { SupportedLocale } from '@lib/config/language-config';
import {
  type AboutTranslationData,
  type ComponentInstance,
  type PageContent,
  isDynamicFormat,
  migrateAboutTranslationData,
} from '@lib/types/about-page-components';

export function getDynamicTranslation(
  translations: Record<SupportedLocale, AboutTranslationData>,
  currentLocale: SupportedLocale
) {
  let translation = translations[currentLocale] || {};

  if (!isDynamicFormat(translation)) {
    translation = migrateAboutTranslationData(translation);
  }

  return translation;
}

export function buildPageContent(
  translation: AboutTranslationData
): PageContent | null {
  if (!translation.sections) {
    return null;
  }

  return {
    sections: translation.sections,
    metadata: translation.metadata || {
      version: '1.0.0',
      lastModified: new Date().toISOString(),
      author: 'admin',
    },
  };
}

export function findComponentById(
  pageContent: PageContent | null,
  componentId: string | null | undefined
): ComponentInstance | null {
  if (!pageContent || !componentId) {
    return null;
  }

  for (const section of pageContent.sections) {
    for (const column of section.columns) {
      const component = column.find(item => item.id === componentId);
      if (component) {
        return component;
      }
    }
  }

  return null;
}
