import type { DragEndEvent } from '@dnd-kit/core';
import type {
  ComponentInstance,
  PageContent,
} from '@lib/types/about-page-components';
import { create } from 'zustand';

import {
  addAboutComponentToPage,
  addAboutSectionToPage,
  deleteAboutComponentFromPage,
  deleteAboutSectionFromPage,
  updateAboutComponentProps,
} from './about-editor-store/content-operations';
import { resolveAboutEditorDragEnd } from './about-editor-store/drag-end';
import {
  createAboutEditorBaseState,
  createAboutEditorCommitState,
  createAboutEditorResetState,
  createAboutEditorSetPageContentState,
} from './about-editor-store/state';
import type { AboutEditorState } from './about-editor-store/types';

export type { AboutEditorState } from './about-editor-store/types';

export const useAboutEditorStore = create<AboutEditorState>((set, get) => ({
  ...createAboutEditorBaseState(),

  setPageContent: (content: PageContent) => {
    set(createAboutEditorSetPageContentState(content));
  },

  setSelectedComponent: (id: string | null) => {
    set({ selectedComponentId: id });
  },

  updateComponentProps: (id: string, props: Record<string, unknown>) => {
    const { pageContent } = get();
    if (!pageContent) {
      return;
    }

    const nextPageContent = updateAboutComponentProps(pageContent, id, props);
    if (!nextPageContent) {
      return;
    }

    set(state => createAboutEditorCommitState(state, nextPageContent));
  },

  addComponent: (
    sectionId: string,
    columnIndex: number,
    component: ComponentInstance
  ) => {
    const { pageContent } = get();
    if (!pageContent) {
      return;
    }

    const nextPageContent = addAboutComponentToPage(
      pageContent,
      sectionId,
      columnIndex,
      component
    );
    if (!nextPageContent) {
      return;
    }

    set(state => createAboutEditorCommitState(state, nextPageContent));
  },

  deleteComponent: (id: string) => {
    const state = get();
    if (!state.pageContent) {
      return;
    }

    const nextPageContent = deleteAboutComponentFromPage(state.pageContent, id);
    if (!nextPageContent) {
      return;
    }

    set(currentState =>
      createAboutEditorCommitState(currentState, nextPageContent, {
        selectedComponentId:
          currentState.selectedComponentId === id
            ? null
            : currentState.selectedComponentId,
      })
    );
  },

  handleDragEnd: (event: DragEndEvent): boolean => {
    const result = resolveAboutEditorDragEnd(event, get());
    if (result.state) {
      set(result.state);
    }
    return result.handled;
  },

  addSection: (layout = 'single-column') => {
    const { pageContent } = get();
    if (!pageContent) {
      return;
    }

    const nextPageContent = addAboutSectionToPage(pageContent, layout);
    set(state => createAboutEditorCommitState(state, nextPageContent));
  },

  deleteSection: (sectionId: string) => {
    const { pageContent } = get();
    if (!pageContent) {
      return;
    }

    const nextPageContent = deleteAboutSectionFromPage(pageContent, sectionId);
    set(state => createAboutEditorCommitState(state, nextPageContent));
  },

  undo: () => {
    const state = get();
    if (state.undoStack.length === 0 || !state.pageContent) {
      return;
    }

    const previousState = state.undoStack[state.undoStack.length - 1];
    set({
      pageContent: previousState,
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [state.pageContent, ...state.redoStack].slice(0, 20),
      selectedComponentId: null,
    });
  },

  redo: () => {
    const state = get();
    if (state.redoStack.length === 0 || !state.pageContent) {
      return;
    }

    const nextState = state.redoStack[0];
    set({
      pageContent: nextState,
      undoStack: [...state.undoStack, state.pageContent].slice(-20),
      redoStack: state.redoStack.slice(1),
      selectedComponentId: null,
    });
  },

  setLoading: (loading: boolean) => {
    set({ isLoading: loading });
  },

  setDirty: (dirty: boolean) => {
    set({ isDirty: dirty });
  },

  setCurrentLanguage: (language: string) => {
    set({ currentLanguage: language });
  },

  reset: () => {
    set(createAboutEditorResetState());
  },
}));
