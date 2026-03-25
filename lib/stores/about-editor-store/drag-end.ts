import type { DragEndEvent } from '@dnd-kit/core';

import { handleAboutComponentDrag } from './drag-component';
import { handleAboutPaletteDrag } from './drag-palette';
import { handleAboutSectionDrag } from './drag-section';
import type { AboutDragEndResult, AboutEditorState } from './types';

export function resolveAboutEditorDragEnd(
  event: DragEndEvent,
  state: Pick<AboutEditorState, 'pageContent' | 'undoStack'>
): AboutDragEndResult {
  const { active, over } = event;
  if (!over || !state.pageContent) {
    return { handled: false };
  }

  const activeId = String(active.id);
  const overId = String(over.id);

  const sectionResult = handleAboutSectionDrag(
    activeId,
    overId,
    state.pageContent
  );
  if (sectionResult) {
    return sectionResult;
  }

  const paletteResult = handleAboutPaletteDrag(activeId, overId, state);
  if (paletteResult) {
    return paletteResult;
  }

  const activeContainer = active.data.current?.sortable?.containerId as
    | string
    | undefined;
  const overContainer =
    (over.data.current?.sortable?.containerId as string | undefined) || overId;

  return handleAboutComponentDrag(
    activeId,
    overId,
    activeContainer,
    overContainer,
    state
  );
}
