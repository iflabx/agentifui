import { availableComponents } from '@components/admin/content/component-palette';
import type { PageContent } from '@lib/types/about-page-components';

import {
  appendNewSectionWithComponent,
  buildPaletteComponent,
} from './content-operations';
import {
  commitAboutDragState,
  findAboutDropTargetContainer,
  parseAboutContainerId,
} from './drag-utils';
import type { AboutDragEndResult, AboutEditorState } from './types';

export function handleAboutPaletteDrag(
  activeId: string,
  overId: string,
  state: Pick<AboutEditorState, 'pageContent' | 'undoStack'>
): AboutDragEndResult | null {
  if (!activeId.startsWith('palette-') || !state.pageContent) {
    return null;
  }

  const componentType = activeId.replace('palette-', '');
  const componentDef = availableComponents.find(
    comp => comp.type === componentType
  );
  if (!componentDef) {
    return { handled: false };
  }

  const newComponent = buildPaletteComponent(
    componentDef.type,
    componentDef.defaultProps
  );

  if (overId.startsWith('section-drop-')) {
    const insertIndex =
      overId === 'section-drop-final'
        ? undefined
        : Number(overId.replace('section-drop-', ''));
    const nextPageContent = appendNewSectionWithComponent(
      state.pageContent,
      newComponent,
      insertIndex
    );

    return {
      handled: true,
      state: commitAboutDragState(state, nextPageContent),
    };
  }

  const target = findAboutDropTargetContainer(state.pageContent, overId);
  if (!target) {
    return { handled: false };
  }

  const parsedTarget = parseAboutContainerId(target.containerId);
  if (!parsedTarget) {
    return { handled: false };
  }

  const nextPageContent: PageContent = {
    ...state.pageContent,
    sections: state.pageContent.sections.map(section => ({
      ...section,
      columns: section.columns.map(column => [...column]),
    })),
  };
  const section = nextPageContent.sections.find(
    item => item.id === parsedTarget.sectionId
  );
  if (!section || !section.columns[parsedTarget.columnIndex]) {
    return { handled: false };
  }

  if (target.insertIndex === -1) {
    section.columns[parsedTarget.columnIndex].push(newComponent);
  } else {
    section.columns[parsedTarget.columnIndex].splice(
      target.insertIndex,
      0,
      newComponent
    );
  }

  return {
    handled: true,
    state: commitAboutDragState(state, nextPageContent),
  };
}
