import type { ComponentInstance } from '@lib/types/about-page-components';
import { cn } from '@lib/utils';

import type { MouseEvent } from 'react';

import ComponentRenderer from '../component-renderer';

interface AboutEditorComponentCardProps {
  component: ComponentInstance;
  editingContent: string | null;
  isEditing: boolean;
  isSelected: boolean;
  onCancelEdit: () => void;
  onClick: () => void;
  onContextMenu: (event: MouseEvent) => void;
  onDoubleClick: () => void;
  onEditChange: (value: string) => void;
  onSaveEdit: () => void;
}

export function AboutEditorComponentCard({
  component,
  editingContent,
  isEditing,
  isSelected,
  onCancelEdit,
  onClick,
  onContextMenu,
  onDoubleClick,
  onEditChange,
  onSaveEdit,
}: AboutEditorComponentCardProps) {
  return (
    <div
      className={cn(
        'mb-3 cursor-pointer rounded-lg border p-3 transition-all',
        isSelected
          ? 'border-stone-500 bg-stone-100 dark:border-stone-400 dark:bg-stone-700'
          : 'border-stone-200 bg-white hover:border-stone-300 hover:bg-stone-50 dark:border-stone-600 dark:bg-stone-800 dark:hover:border-stone-500 dark:hover:bg-stone-700'
      )}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      data-component-id={component.id}
    >
      {isEditing ? (
        <div
          className="space-y-2"
          onClick={event => event.stopPropagation()}
          onMouseDown={event => event.stopPropagation()}
        >
          <textarea
            value={editingContent || ''}
            onChange={event => onEditChange(event.target.value)}
            onClick={event => event.stopPropagation()}
            onMouseDown={event => event.stopPropagation()}
            onKeyDown={event => {
              if (event.key === 'Enter' && event.ctrlKey) {
                event.preventDefault();
                onSaveEdit();
              }
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancelEdit();
              }
              event.stopPropagation();
            }}
            className="resize-vertical min-h-[60px] w-full rounded border p-2 text-sm focus:ring-2 focus:ring-stone-500 focus:outline-none"
            placeholder="Enter content..."
            autoFocus
            onBlur={event => {
              const relatedTarget = event.relatedTarget as HTMLElement;
              const editContainer = event.currentTarget.closest('.space-y-2');

              if (!relatedTarget || !editContainer?.contains(relatedTarget)) {
                setTimeout(() => {
                  onSaveEdit();
                }, 100);
              }
            }}
          />
          <div className="text-muted-foreground flex gap-2 text-xs">
            <span>Ctrl+Enter to save • Escape to cancel</span>
          </div>
        </div>
      ) : (
        <ComponentRenderer component={component} />
      )}
    </div>
  );
}
