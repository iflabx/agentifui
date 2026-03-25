import { arrayMove } from '@components/admin/content/dnd-components';
import type { PageContent } from '@lib/types/about-page-components';

import { appendNewSectionWithComponent } from './content-operations';
import {
  commitAboutDragState,
  finalizeDraggedPageContent,
  findAboutLocationForId,
  parseAboutContainerId,
} from './drag-utils';
import type { AboutDragEndResult, AboutEditorState } from './types';

function moveComponentToNewSection(
  overId: string,
  activeId: string,
  state: Pick<AboutEditorState, 'pageContent' | 'undoStack'>
): AboutDragEndResult {
  if (!state.pageContent) {
    return { handled: false };
  }

  const nextPageContent: PageContent = {
    ...state.pageContent,
    sections: state.pageContent.sections.map(section => ({
      ...section,
      columns: section.columns.map(column => [...column]),
    })),
  };
  const sourceLocation = findAboutLocationForId(nextPageContent, activeId);
  if (!sourceLocation) {
    return { handled: false };
  }

  const [movedComponent] = sourceLocation.column.splice(
    sourceLocation.componentIndex,
    1
  );
  const insertIndex =
    overId === 'section-drop-final'
      ? undefined
      : Number(overId.replace('section-drop-', ''));
  const pageWithNewSection = appendNewSectionWithComponent(
    nextPageContent,
    movedComponent,
    insertIndex
  );

  return {
    handled: true,
    state: commitAboutDragState(
      state,
      finalizeDraggedPageContent(pageWithNewSection)
    ),
  };
}

function reorderWithinContainer(
  activeId: string,
  overId: string,
  state: Pick<AboutEditorState, 'pageContent' | 'undoStack'>
): AboutDragEndResult {
  if (!state.pageContent) {
    return { handled: false };
  }

  const nextPageContent: PageContent = {
    ...state.pageContent,
    sections: state.pageContent.sections.map(section => ({
      ...section,
      columns: section.columns.map(column => [...column]),
    })),
  };

  let targetSectionId: string | null = null;
  let targetColumnIndex: number | null = null;

  for (const section of nextPageContent.sections) {
    for (
      let columnIndex = 0;
      columnIndex < section.columns.length;
      columnIndex++
    ) {
      const column = section.columns[columnIndex];
      if (
        column.some(comp => comp.id === activeId) &&
        column.some(comp => comp.id === overId)
      ) {
        targetSectionId = section.id;
        targetColumnIndex = columnIndex;
        break;
      }
    }
    if (targetSectionId) {
      break;
    }
  }

  if (!targetSectionId || targetColumnIndex === null) {
    return { handled: false };
  }

  const section = nextPageContent.sections.find(
    item => item.id === targetSectionId
  );
  if (!section || !section.columns[targetColumnIndex]) {
    return { handled: false };
  }

  const column = section.columns[targetColumnIndex];
  const activeIndex = column.findIndex(comp => comp.id === activeId);
  const overIndex = column.findIndex(comp => comp.id === overId);
  if (activeIndex === -1 || overIndex === -1) {
    return { handled: false };
  }

  if (activeIndex === overIndex) {
    return { handled: true };
  }

  section.columns[targetColumnIndex] = arrayMove(
    column,
    activeIndex,
    overIndex
  );
  return {
    handled: true,
    state: commitAboutDragState(
      state,
      finalizeDraggedPageContent(nextPageContent)
    ),
  };
}

function moveAcrossContainers(
  activeId: string,
  overId: string,
  state: Pick<AboutEditorState, 'pageContent' | 'undoStack'>
): AboutDragEndResult {
  if (!state.pageContent) {
    return { handled: false };
  }

  const nextPageContent: PageContent = {
    ...state.pageContent,
    sections: state.pageContent.sections.map(section => ({
      ...section,
      columns: section.columns.map(column => [...column]),
    })),
  };
  const sourceLocation = findAboutLocationForId(nextPageContent, activeId);
  if (!sourceLocation) {
    return { handled: false };
  }

  if (overId.startsWith('section-')) {
    const parsedTarget = parseAboutContainerId(overId);
    if (!parsedTarget) {
      return { handled: false };
    }

    const targetSection = nextPageContent.sections.find(
      section => section.id === parsedTarget.sectionId
    );
    if (!targetSection || !targetSection.columns[parsedTarget.columnIndex]) {
      return { handled: false };
    }

    const [removed] = sourceLocation.column.splice(
      sourceLocation.componentIndex,
      1
    );
    targetSection.columns[parsedTarget.columnIndex].push(removed);

    return {
      handled: true,
      state: commitAboutDragState(
        state,
        finalizeDraggedPageContent(nextPageContent)
      ),
    };
  }

  const destinationLocation = findAboutLocationForId(nextPageContent, overId);
  if (!destinationLocation) {
    return { handled: false };
  }

  const [removed] = sourceLocation.column.splice(
    sourceLocation.componentIndex,
    1
  );
  destinationLocation.column.splice(
    destinationLocation.componentIndex,
    0,
    removed
  );

  return {
    handled: true,
    state: commitAboutDragState(
      state,
      finalizeDraggedPageContent(nextPageContent)
    ),
  };
}

export function handleAboutComponentDrag(
  activeId: string,
  overId: string,
  activeContainer: string | undefined,
  overContainer: string | undefined,
  state: Pick<AboutEditorState, 'pageContent' | 'undoStack'>
): AboutDragEndResult {
  if (overId.startsWith('section-drop-')) {
    return moveComponentToNewSection(overId, activeId, state);
  }

  if (!activeContainer || !overContainer) {
    return { handled: false };
  }

  if (activeContainer === overContainer) {
    return reorderWithinContainer(activeId, overId, state);
  }

  return moveAcrossContainers(activeId, overId, state);
}
