import type { PageContent } from '@lib/types/about-page-components';

import { MAX_UNDO_STEPS } from './types';
import type { AboutEditorCoreState, AboutEditorState } from './types';

export function createAboutEditorBaseState(): AboutEditorCoreState {
  return {
    pageContent: null,
    selectedComponentId: null,
    undoStack: [],
    redoStack: [],
    isDirty: false,
    isLoading: false,
    currentLanguage: 'en-US',
  };
}

export function createAboutEditorSetPageContentState(
  content: PageContent
): Partial<AboutEditorState> {
  return {
    pageContent: content,
    selectedComponentId: null,
    isDirty: false,
  };
}

export function createAboutEditorCommitState(
  state: Pick<AboutEditorState, 'pageContent' | 'undoStack'>,
  pageContent: PageContent,
  extra: Partial<AboutEditorState> = {}
): Partial<AboutEditorState> {
  if (!state.pageContent) {
    return {
      pageContent,
      redoStack: [],
      isDirty: true,
      ...extra,
    };
  }

  return {
    pageContent,
    undoStack: [...state.undoStack, state.pageContent].slice(-MAX_UNDO_STEPS),
    redoStack: [],
    isDirty: true,
    ...extra,
  };
}

export function createAboutEditorResetState(): AboutEditorCoreState {
  return createAboutEditorBaseState();
}
