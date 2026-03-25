/** @jest-environment node */
import type { DragEndEvent } from '@dnd-kit/core';
import { useAboutEditorStore } from '@lib/stores/about-editor-store';
import { createDefaultSection } from '@lib/types/about-page-components';

function createStorePageContent() {
  const first = createDefaultSection('single-column');
  first.id = 'section-a';
  first.columns[0].push({
    id: 'comp-a',
    type: 'heading',
    props: { content: 'A', level: 1, textAlign: 'left' },
  });

  const second = createDefaultSection('single-column');
  second.id = 'section-b';
  second.columns[0].push({
    id: 'comp-b',
    type: 'paragraph',
    props: { content: 'B', textAlign: 'left' },
  });

  return {
    sections: [first, second],
  };
}

function createDragEvent(event: Partial<DragEndEvent>): DragEndEvent {
  return {
    active: {
      id: 'active',
      data: { current: {} },
      rect: { current: { initial: null, translated: null } },
    },
    collisions: null,
    delta: { x: 0, y: 0 },
    over: null,
    activatorEvent: {} as Event,
    ...event,
  } as DragEndEvent;
}

describe('about editor store', () => {
  beforeEach(() => {
    useAboutEditorStore.setState({
      ...useAboutEditorStore.getInitialState(),
    });
  });

  it('updates component props and records undo state', () => {
    const store = useAboutEditorStore.getState();
    store.setPageContent(createStorePageContent());

    store.updateComponentProps('comp-a', { content: 'Updated' });

    const next = useAboutEditorStore.getState();
    expect(next.pageContent?.sections[0]?.columns[0]?.[0]?.props).toMatchObject(
      {
        content: 'Updated',
      }
    );
    expect(next.undoStack).toHaveLength(1);
    expect(next.redoStack).toHaveLength(0);
    expect(next.isDirty).toBe(true);
  });

  it('supports undo and redo after adding a section', () => {
    const store = useAboutEditorStore.getState();
    store.setPageContent(createStorePageContent());

    store.addSection('two-column');
    expect(useAboutEditorStore.getState().pageContent?.sections).toHaveLength(
      3
    );

    store.undo();
    expect(useAboutEditorStore.getState().pageContent?.sections).toHaveLength(
      2
    );

    store.redo();
    expect(useAboutEditorStore.getState().pageContent?.sections).toHaveLength(
      3
    );
  });

  it('creates a new section when dropping a palette component on section-drop-final', () => {
    const store = useAboutEditorStore.getState();
    store.setPageContent(createStorePageContent());

    const handled = store.handleDragEnd(
      createDragEvent({
        active: {
          id: 'palette-heading',
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as DragEndEvent['active'],
        over: {
          id: 'section-drop-final',
          data: { current: {} },
          rect: { top: 0, left: 0, width: 0, height: 0 },
          disabled: false,
        } as NonNullable<DragEndEvent['over']>,
      })
    );

    const next = useAboutEditorStore.getState();
    expect(handled).toBe(true);
    expect(next.pageContent?.sections).toHaveLength(3);
    expect(next.pageContent?.sections[2]?.columns[0]).toHaveLength(1);
    expect(next.undoStack).toHaveLength(1);
  });

  it('reorders sections through drag end', () => {
    const store = useAboutEditorStore.getState();
    store.setPageContent(createStorePageContent());

    const handled = store.handleDragEnd(
      createDragEvent({
        active: {
          id: 'section-section-a',
          data: { current: {} },
          rect: { current: { initial: null, translated: null } },
        } as DragEndEvent['active'],
        over: {
          id: 'section-drop-final',
          data: { current: {} },
          rect: { top: 0, left: 0, width: 0, height: 0 },
          disabled: false,
        } as NonNullable<DragEndEvent['over']>,
      })
    );

    const next = useAboutEditorStore.getState();
    expect(handled).toBe(true);
    expect(next.pageContent?.sections.map(section => section.id)).toEqual([
      'section-b',
      'section-a',
    ]);
  });
});
