import type { DragEndEvent } from '@dnd-kit/core';
import type {
  ComponentInstance,
  PageContent,
  PageSection,
} from '@lib/types/about-page-components';

export const MAX_UNDO_STEPS = 20;

export interface AboutEditorState {
  pageContent: PageContent | null;
  selectedComponentId: string | null;
  undoStack: PageContent[];
  redoStack: PageContent[];
  isDirty: boolean;
  isLoading: boolean;
  currentLanguage: string;
  setPageContent: (content: PageContent) => void;
  setSelectedComponent: (id: string | null) => void;
  updateComponentProps: (id: string, props: Record<string, unknown>) => void;
  addComponent: (
    sectionId: string,
    columnIndex: number,
    component: ComponentInstance
  ) => void;
  deleteComponent: (id: string) => void;
  handleDragEnd: (event: DragEndEvent) => boolean;
  addSection: (
    layout?: 'single-column' | 'two-column' | 'three-column'
  ) => void;
  deleteSection: (sectionId: string) => void;
  undo: () => void;
  redo: () => void;
  setLoading: (loading: boolean) => void;
  setDirty: (dirty: boolean) => void;
  setCurrentLanguage: (language: string) => void;
  reset: () => void;
}

export type AboutEditorCoreState = Pick<
  AboutEditorState,
  | 'pageContent'
  | 'selectedComponentId'
  | 'undoStack'
  | 'redoStack'
  | 'isDirty'
  | 'isLoading'
  | 'currentLanguage'
>;

export interface AboutComponentLocation {
  sectionIndex: number;
  columnIndex: number;
  componentIndex: number;
  section: PageSection;
  column: ComponentInstance[];
  component: ComponentInstance;
}

export interface AboutDragEndResult {
  handled: boolean;
  state?: Partial<AboutEditorState>;
}
