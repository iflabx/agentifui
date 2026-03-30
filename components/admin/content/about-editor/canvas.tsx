import type {
  ComponentInstance,
  PageContent,
} from '@lib/types/about-page-components';
import { cn } from '@lib/utils';
import { GripVertical, Trash2 } from 'lucide-react';

import type { MouseEvent } from 'react';

import { Droppable, Sortable, SortableContainer } from '../dnd-components';
import { DragPreviewRenderer } from '../drag-preview-renderer';
import { SectionDragPreview } from '../section-drag-preview';
import { AboutEditorComponentCard } from './component-card';

interface AboutEditorCanvasProps {
  editingComponentId: string | null;
  editingContent: string | null;
  isStructureLocked: boolean;
  onCancelEdit: () => void;
  onComponentClick: (componentId: string) => void;
  onComponentContextMenu: (event: MouseEvent, componentId: string) => void;
  onDeleteSection: (sectionId: string) => void;
  onDoubleClick: (componentId: string) => void;
  onEditChange: (value: string) => void;
  onGlobalContextMenu: (event: MouseEvent) => void;
  onSaveEdit: () => void;
  pageContent: PageContent;
  selectedComponentId: string | null;
}

export function AboutEditorCanvas({
  editingComponentId,
  editingContent,
  isStructureLocked,
  onCancelEdit,
  onComponentClick,
  onComponentContextMenu,
  onDeleteSection,
  onDoubleClick,
  onEditChange,
  onGlobalContextMenu,
  onSaveEdit,
  pageContent,
  selectedComponentId,
}: AboutEditorCanvasProps) {
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="space-y-6 p-6" onContextMenu={onGlobalContextMenu}>
        {pageContent.sections.map((section, sectionIndex) => {
          const sectionDragPreview = (
            <SectionDragPreview section={section} sectionIndex={sectionIndex} />
          );

          return (
            <div key={section.id} className="space-y-4">
              {sectionIndex > 0 && (
                <Droppable
                  id={`section-drop-${sectionIndex}`}
                  disabled={isStructureLocked}
                  className="h-2 rounded-lg border-2 border-dashed border-transparent transition-all duration-200 hover:h-16 hover:border-stone-400 hover:bg-stone-100 dark:hover:border-stone-500 dark:hover:bg-stone-800"
                >
                  {(isOver: boolean) => (
                    <div
                      className={cn(
                        'flex h-full items-center justify-center text-sm font-medium text-stone-600 transition-opacity duration-200 dark:text-stone-400',
                        isOver || undefined
                          ? 'opacity-100'
                          : 'opacity-0 hover:opacity-100'
                      )}
                    >
                      Drop here to reorder sections
                    </div>
                  )}
                </Droppable>
              )}

              <Sortable
                id={`section-${section.id}`}
                preview={sectionDragPreview}
                disabled={isStructureLocked}
                className={cn(
                  'group cursor-grab rounded-lg border p-4 transition-all',
                  'border-stone-200 bg-white hover:border-stone-300 hover:shadow-md',
                  'dark:border-stone-700 dark:bg-stone-800 dark:hover:border-stone-600'
                )}
              >
                <div className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GripVertical
                        className={cn(
                          'h-4 w-4 text-stone-400 opacity-0 transition-opacity group-hover:opacity-100',
                          'dark:text-stone-500'
                        )}
                      />
                      <h3
                        className={cn(
                          'text-sm font-medium',
                          'text-stone-600 dark:text-stone-400'
                        )}
                      >
                        Section {sectionIndex + 1} • {section.layout}
                      </h3>
                    </div>
                    {!isStructureLocked && (
                      <button
                        onClick={event => {
                          event.stopPropagation();
                          onDeleteSection(section.id);
                        }}
                        className={cn(
                          'flex h-6 w-6 items-center justify-center rounded p-0 text-red-500 transition-colors',
                          'hover:bg-red-100 dark:hover:bg-red-900/50'
                        )}
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                </div>
                <div
                  className={cn(
                    'grid gap-4',
                    section.layout === 'single-column' && 'grid-cols-1',
                    section.layout === 'two-column' && 'grid-cols-2',
                    section.layout === 'three-column' && 'grid-cols-3'
                  )}
                >
                  {section.columns.map((column, columnIndex) => {
                    const columnItems = column.map(comp => comp.id);
                    return (
                      <SortableContainer
                        key={`${section.id}-${columnIndex}`}
                        id={`section-${section.id}-${columnIndex}`}
                        items={columnItems}
                        disabled={isStructureLocked}
                        className={cn(
                          'min-h-24 rounded-md border-2 border-dashed p-3 transition-all duration-200',
                          'border-stone-300 bg-stone-50 hover:border-stone-400 hover:bg-stone-100',
                          'dark:border-stone-600 dark:bg-stone-700/50 dark:hover:border-stone-500 dark:hover:bg-stone-600/50'
                        )}
                      >
                        {column.length === 0 && (
                          <div
                            className={cn(
                              'flex h-16 items-center justify-center text-sm',
                              'text-stone-500 dark:text-stone-400'
                            )}
                          >
                            Drop components here
                          </div>
                        )}

                        {column.map((component: ComponentInstance) => {
                          const dragPreview = (
                            <DragPreviewRenderer component={component} />
                          );
                          const isEditing = editingComponentId === component.id;

                          return (
                            <Sortable
                              key={component.id}
                              id={component.id}
                              preview={dragPreview}
                              disabled={isStructureLocked}
                            >
                              <AboutEditorComponentCard
                                component={component}
                                editingContent={
                                  isEditing ? editingContent : null
                                }
                                isEditing={isEditing}
                                isSelected={
                                  selectedComponentId === component.id
                                }
                                onCancelEdit={onCancelEdit}
                                onClick={() => onComponentClick(component.id)}
                                onContextMenu={event =>
                                  onComponentContextMenu(event, component.id)
                                }
                                onDoubleClick={() =>
                                  onDoubleClick(component.id)
                                }
                                onEditChange={onEditChange}
                                onSaveEdit={onSaveEdit}
                              />
                            </Sortable>
                          );
                        })}
                      </SortableContainer>
                    );
                  })}
                </div>
              </Sortable>
            </div>
          );
        })}

        <Droppable
          id="section-drop-final"
          disabled={isStructureLocked}
          className="h-8 rounded-lg border-2 border-dashed border-transparent transition-all duration-200 hover:h-16 hover:border-stone-400 hover:bg-stone-100 dark:hover:border-stone-500 dark:hover:bg-stone-800"
        >
          {(isOver: boolean) => (
            <div
              className={cn(
                'flex h-full items-center justify-center text-sm font-medium text-stone-600 transition-opacity duration-200 dark:text-stone-400',
                isOver || undefined
                  ? 'opacity-100'
                  : 'opacity-0 hover:opacity-100'
              )}
            >
              Drop here to create new section
            </div>
          )}
        </Droppable>
      </div>
    </div>
  );
}
