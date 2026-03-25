'use client';

import type { SupportedLocale } from '@lib/config/language-config';
import { useAboutEditorStore } from '@lib/stores/about-editor-store';
import type { AboutTranslationData } from '@lib/types/about-page-components';
import { cn } from '@lib/utils';
import {
  useDebouncedCallback,
  useThrottledCallback,
} from '@lib/utils/performance';

import {
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { useTranslations } from 'next-intl';

import { AboutEditorCanvas } from './about-editor/canvas';
import { AboutEditorHeader } from './about-editor/editor-header';
import {
  buildPageContent,
  findComponentById,
  getDynamicTranslation,
} from './about-editor/helpers';
import ComponentPalette from './component-palette';
import { ContextMenu } from './context-menu';
import { DndContextWrapper } from './dnd-context';

interface AboutEditorProps {
  translations: Record<SupportedLocale, AboutTranslationData>;
  currentLocale: SupportedLocale;
  supportedLocales: SupportedLocale[];
  onTranslationsChange: (
    newTranslations: Record<SupportedLocale, AboutTranslationData>
  ) => void;
  onLocaleChange: (newLocale: SupportedLocale) => void;
}

export function AboutEditor({
  translations,
  currentLocale,
  supportedLocales,
  onTranslationsChange,
  onLocaleChange,
}: AboutEditorProps) {
  const t = useTranslations('pages.admin.content.editor');

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    componentId: string;
  } | null>(null);
  const [editingComponent, setEditingComponent] = useState<{
    componentId: string;
    content: string;
  } | null>(null);

  const {
    pageContent,
    selectedComponentId,
    undoStack,
    redoStack,
    isDirty,
    setPageContent,
    setSelectedComponent,
    updateComponentProps,
    deleteComponent,
    deleteSection,
    handleDragEnd,
    addSection,
    undo,
    redo,
    setCurrentLanguage,
  } = useAboutEditorStore();

  const currentTranslation = useMemo(
    () => getDynamicTranslation(translations, currentLocale),
    [translations, currentLocale]
  );

  const contextMenuComponent = useMemo(
    () => findComponentById(pageContent, contextMenu?.componentId),
    [pageContent, contextMenu?.componentId]
  );

  useEffect(() => {
    const content = buildPageContent(currentTranslation);
    if (content) {
      setPageContent(content);
    }
    setCurrentLanguage(currentLocale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentLocale, setCurrentLanguage, setPageContent]);

  const debouncedSave = useDebouncedCallback(
    useCallback(async () => {
      if (!pageContent) {
        return;
      }

      const updatedTranslation: AboutTranslationData = {
        sections: pageContent.sections,
        metadata: {
          ...pageContent.metadata,
          lastModified: new Date().toISOString(),
        },
      };

      onTranslationsChange({
        ...translations,
        [currentLocale]: updatedTranslation,
      });
    }, [pageContent, translations, currentLocale, onTranslationsChange]),
    100,
    [pageContent, translations, currentLocale]
  );

  useEffect(() => {
    if (pageContent) {
      debouncedSave();
    }
  }, [pageContent, debouncedSave]);

  const throttledPropsChange = useThrottledCallback(
    useCallback(
      (newProps: Record<string, unknown>) => {
        if (selectedComponentId) {
          updateComponentProps(selectedComponentId, newProps);
          debouncedSave();
        }
      },
      [debouncedSave, selectedComponentId, updateComponentProps]
    ),
    100,
    [selectedComponentId, updateComponentProps]
  );

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handlePropsChange = throttledPropsChange;

  const handleDeleteComponent = useCallback(
    (componentId: string) => {
      deleteComponent(componentId);
      setContextMenu(null);
    },
    [deleteComponent]
  );

  const focusEditorContainer = () => {
    const container = document.querySelector('[tabindex="0"]') as HTMLElement;
    container?.focus();
  };

  const handleComponentClick = useCallback(
    (componentId: string) => {
      setSelectedComponent(componentId);
      focusEditorContainer();
    },
    [setSelectedComponent]
  );

  const handleContextMenu = useCallback(
    (event: MouseEvent, componentId: string) => {
      event.preventDefault();
      event.stopPropagation();

      const targetComponent = findComponentById(pageContent, componentId);
      if (!targetComponent) {
        return;
      }

      setSelectedComponent(componentId);
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        componentId,
      });
      focusEditorContainer();
    },
    [pageContent, setSelectedComponent]
  );

  const handleContextMenuPropsChange = useCallback(
    (newProps: Record<string, unknown>) => {
      if (contextMenu?.componentId) {
        updateComponentProps(contextMenu.componentId, newProps);
        debouncedSave();
      }
    },
    [contextMenu?.componentId, debouncedSave, updateComponentProps]
  );

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Delete' && selectedComponentId) {
      event.preventDefault();
      handleDeleteComponent(selectedComponentId);
    }
    if (event.key === 'Escape' && editingComponent) {
      event.preventDefault();
      setEditingComponent(null);
    }
  };

  const handleDoubleClick = useCallback(
    (componentId: string) => {
      const targetComponent = findComponentById(pageContent, componentId);
      if (targetComponent?.props.content) {
        setEditingComponent({
          componentId,
          content: String(targetComponent.props.content || ''),
        });
      }
    },
    [pageContent]
  );

  const handleSaveEdit = useCallback(() => {
    if (!editingComponent) {
      return;
    }

    updateComponentProps(editingComponent.componentId, {
      content: editingComponent.content,
    });
    setEditingComponent(null);
    debouncedSave();
  }, [debouncedSave, editingComponent, updateComponentProps]);

  const handleEditInputChange = useCallback((value: string) => {
    setEditingComponent(prev =>
      prev
        ? {
            ...prev,
            content: value,
          }
        : null
    );
  }, []);

  const handleGlobalContextMenu = useCallback(
    (event: MouseEvent) => {
      if (contextMenu) {
        return;
      }

      const target = event.target as HTMLElement;
      const componentElement = target.closest(
        '[data-component-id]'
      ) as HTMLElement | null;
      const componentId = componentElement?.getAttribute('data-component-id');

      if (componentId) {
        event.preventDefault();
        event.stopPropagation();
        handleContextMenu(event, componentId);
      }
    },
    [contextMenu, handleContextMenu]
  );

  if (!pageContent) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-muted-foreground">Loading editor...</p>
      </div>
    );
  }

  return (
    <DndContextWrapper onDragEnd={handleDragEnd}>
      <div
        className="flex h-full flex-col focus:outline-none"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <AboutEditorHeader
          currentLocale={currentLocale}
          isDirty={isDirty}
          onAddSection={() => addSection('single-column')}
          onLocaleChange={onLocaleChange}
          onRedo={redo}
          onUndo={undo}
          redoCount={redoStack.length}
          sectionCount={pageContent.sections.length}
          supportedLocales={supportedLocales}
          t={t}
          undoCount={undoStack.length}
        />

        <div className="flex min-h-0 flex-1">
          <div
            className={cn(
              'w-64 overflow-x-hidden overflow-y-auto border-r p-4',
              'border-stone-200 bg-stone-50 dark:border-stone-700 dark:bg-stone-900'
            )}
          >
            <ComponentPalette />
          </div>

          <AboutEditorCanvas
            editingComponentId={editingComponent?.componentId || null}
            editingContent={editingComponent?.content || null}
            onCancelEdit={() => setEditingComponent(null)}
            onComponentClick={handleComponentClick}
            onComponentContextMenu={handleContextMenu}
            onDeleteSection={deleteSection}
            onDoubleClick={handleDoubleClick}
            onEditChange={handleEditInputChange}
            onGlobalContextMenu={handleGlobalContextMenu}
            onSaveEdit={handleSaveEdit}
            pageContent={pageContent}
            selectedComponentId={selectedComponentId}
          />
        </div>
      </div>

      {contextMenu && contextMenuComponent && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          component={contextMenuComponent}
          onPropsChange={handleContextMenuPropsChange}
          onDelete={handleDeleteComponent}
          onClose={() => setContextMenu(null)}
        />
      )}
    </DndContextWrapper>
  );
}
