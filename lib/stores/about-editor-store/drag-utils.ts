import type { PageContent } from '@lib/types/about-page-components';

import {
  cleanAboutPageContent,
  cloneAboutPageContent,
  findAboutComponentLocation,
} from './content-operations';
import type { AboutEditorState } from './types';

export function cloneAboutPageContentForDrag(
  pageContent: PageContent
): PageContent {
  return {
    ...pageContent,
    sections: pageContent.sections.map(section => ({
      ...section,
      columns: section.columns.map(column => [...column]),
    })),
  };
}

export function commitAboutDragState(
  state: Pick<AboutEditorState, 'pageContent' | 'undoStack'>,
  pageContent: PageContent
): Partial<AboutEditorState> {
  if (!state.pageContent) {
    return {
      pageContent,
      redoStack: [],
      isDirty: true,
    };
  }

  return {
    pageContent,
    undoStack: [...state.undoStack, state.pageContent].slice(-20),
    redoStack: [],
    isDirty: true,
  };
}

export function finalizeDraggedPageContent(
  pageContent: PageContent
): PageContent {
  return cleanAboutPageContent(pageContent);
}

export function parseAboutContainerId(containerId: string): {
  sectionId: string;
  columnIndex: number;
} | null {
  if (!containerId.startsWith('section-')) {
    return null;
  }

  const parts = containerId.split('-');
  const columnIndex = Number(parts[parts.length - 1]);
  if (Number.isNaN(columnIndex)) {
    return null;
  }

  const sectionId = parts.slice(1, -1).join('-');
  if (!sectionId) {
    return null;
  }

  return { sectionId, columnIndex };
}

export function resolveAboutDropIndex(overId: string): number | null {
  if (!overId.startsWith('section-drop-')) {
    return null;
  }

  if (overId === 'section-drop-final') {
    return Number.MAX_SAFE_INTEGER;
  }

  const index = Number(overId.replace('section-drop-', ''));
  return Number.isNaN(index) ? null : index;
}

export function findAboutDropTargetContainer(
  pageContent: PageContent,
  overId: string
): { containerId: string; insertIndex: number } | null {
  if (overId.startsWith('section-')) {
    return { containerId: overId, insertIndex: -1 };
  }

  const pageClone = cloneAboutPageContent(pageContent);
  const location = findAboutComponentLocation(pageClone, overId);
  if (!location) {
    return null;
  }

  return {
    containerId: `section-${location.section.id}-${location.columnIndex}`,
    insertIndex: location.componentIndex,
  };
}

export function findAboutLocationForId(
  pageContent: PageContent,
  componentId: string
) {
  return findAboutComponentLocation(pageContent, componentId);
}

export function cloneAboutPageContentUnsafe(
  pageContent: PageContent
): PageContent {
  return cloneAboutPageContent(pageContent);
}
