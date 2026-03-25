import type {
  ComponentInstance,
  LayoutType,
  PageContent,
} from '@lib/types/about-page-components';
import {
  createDefaultSection,
  generateUniqueId,
} from '@lib/types/about-page-components';
import { clonePageContent } from '@lib/utils/performance';

import type { AboutComponentLocation } from './types';

export function cloneAboutPageContent(pageContent: PageContent): PageContent {
  return clonePageContent(pageContent);
}

export function cleanAboutPageContent(pageContent: PageContent): PageContent {
  return {
    ...pageContent,
    sections: pageContent.sections.filter(section =>
      section.columns.some(column => column.length > 0)
    ),
  };
}

export function findAboutComponentLocation(
  pageContent: PageContent,
  componentId: string
): AboutComponentLocation | null {
  for (
    let sectionIndex = 0;
    sectionIndex < pageContent.sections.length;
    sectionIndex++
  ) {
    const section = pageContent.sections[sectionIndex];
    for (
      let columnIndex = 0;
      columnIndex < section.columns.length;
      columnIndex++
    ) {
      const column = section.columns[columnIndex];
      const componentIndex = column.findIndex(comp => comp.id === componentId);
      if (componentIndex !== -1) {
        return {
          sectionIndex,
          columnIndex,
          componentIndex,
          section,
          column,
          component: column[componentIndex],
        };
      }
    }
  }

  return null;
}

export function updateAboutComponentProps(
  pageContent: PageContent,
  id: string,
  props: Record<string, unknown>
): PageContent | null {
  const nextPageContent = cloneAboutPageContent(pageContent);
  const location = findAboutComponentLocation(nextPageContent, id);
  if (!location) {
    return null;
  }

  location.column[location.componentIndex].props = {
    ...location.column[location.componentIndex].props,
    ...props,
  };

  return nextPageContent;
}

export function addAboutComponentToPage(
  pageContent: PageContent,
  sectionId: string,
  columnIndex: number,
  component: ComponentInstance
): PageContent | null {
  const nextPageContent = cloneAboutPageContent(pageContent);
  const section = nextPageContent.sections.find(item => item.id === sectionId);
  if (!section || !section.columns[columnIndex]) {
    return null;
  }

  section.columns[columnIndex].push(component);
  return nextPageContent;
}

export function deleteAboutComponentFromPage(
  pageContent: PageContent,
  id: string
): PageContent | null {
  const nextPageContent = cloneAboutPageContent(pageContent);
  const location = findAboutComponentLocation(nextPageContent, id);
  if (!location) {
    return null;
  }

  location.column.splice(location.componentIndex, 1);
  return cleanAboutPageContent(nextPageContent);
}

export function addAboutSectionToPage(
  pageContent: PageContent,
  layout: LayoutType
): PageContent {
  return {
    ...pageContent,
    sections: [...pageContent.sections, createDefaultSection(layout)],
  };
}

export function deleteAboutSectionFromPage(
  pageContent: PageContent,
  sectionId: string
): PageContent {
  return {
    ...pageContent,
    sections: pageContent.sections.filter(section => section.id !== sectionId),
  };
}

export function buildPaletteComponent(
  type: ComponentInstance['type'],
  props: Record<string, unknown>
): ComponentInstance {
  return {
    id: generateUniqueId('comp'),
    type,
    props: { ...props },
  };
}

export function appendNewSectionWithComponent(
  pageContent: PageContent,
  component: ComponentInstance,
  insertIndex?: number
): PageContent {
  const nextPageContent = cloneAboutPageContent(pageContent);
  const section = createDefaultSection('single-column');
  section.columns[0].push(component);

  if (
    insertIndex === undefined ||
    insertIndex >= nextPageContent.sections.length
  ) {
    nextPageContent.sections.push(section);
  } else {
    nextPageContent.sections.splice(insertIndex, 0, section);
  }

  return nextPageContent;
}
