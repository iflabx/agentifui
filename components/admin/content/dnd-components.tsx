'use client';

import { useDraggable, useDroppable } from '@dnd-kit/core';
import {
  SortableContext,
  SortingStrategy,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@lib/utils';

import React from 'react';

import { useDndState } from './dnd-context';

// Re-export arrayMove for convenience
export { arrayMove };

// Droppable component interface
interface DroppableProps {
  id: string;
  children: React.ReactNode | ((isOver: boolean) => React.ReactNode);
  className?: string;
  disabled?: boolean;
}

/**
 * DndKit Droppable Component
 *
 * Replaces react-beautiful-dnd's Droppable
 */
export function Droppable({
  id,
  children,
  className,
  disabled = false,
}: DroppableProps) {
  const { isOver, setNodeRef } = useDroppable({
    id,
    disabled,
  });

  // Check if this is a section drop zone that should have special hover effects
  const isSectionDropZone = id.includes('section-drop');

  // Apply drag-over styles that mimic hover effects for section drop zones
  const dragOverStyles =
    isSectionDropZone && isOver
      ? {
          height: '4rem', // equivalent to h-16
          borderColor: 'rgb(168 162 158)', // stone-400
          backgroundColor: 'rgb(245 245 244)', // stone-100 light mode
        }
      : {};

  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        // Apply enhanced styles for section drop zones when dragging over
        isSectionDropZone &&
          isOver &&
          'h-16 border-stone-400 bg-stone-100 dark:border-stone-500 dark:bg-stone-800',
        // Default ring effect for other droppables
        !isSectionDropZone && isOver && 'ring-opacity-50 ring-2 ring-stone-500'
      )}
      style={dragOverStyles}
    >
      {typeof children === 'function'
        ? (children as (isOver: boolean) => React.ReactNode)(isOver)
        : children}
    </div>
  );
}

// Draggable component interface
interface DraggableProps {
  id: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  preview?: React.ReactNode;
}

/**
 * DndKit Draggable Component
 *
 * Replaces react-beautiful-dnd's Draggable
 */
export function Draggable({
  id,
  children,
  className,
  disabled = false,
  preview,
}: DraggableProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id,
      disabled,
      data: {
        type: id.startsWith('palette-') ? 'palette-item' : 'component',
        preview,
      },
    });

  const style = {
    transform: CSS.Translate.toString(transform),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        className,
        isDragging && 'scale-95 opacity-50',
        !disabled && 'cursor-grab active:cursor-grabbing'
      )}
      {...listeners}
      {...attributes}
    >
      {children}
    </div>
  );
}

// Sortable component for within containers
interface SortableProps {
  id: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  preview?: React.ReactNode;
  onClick?: () => void;
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

/**
 * DndKit Sortable Component
 *
 * For sortable items within containers
 */
export function Sortable({
  id,
  children,
  className,
  disabled = false,
  preview,
  onClick,
  onDoubleClick,
  onContextMenu,
}: SortableProps) {
  const { isDraggingFromPalette } = useDndState();

  // Normal sortable behavior - always call hooks at the top level
  const shouldDisable = disabled;

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    isOver,
  } = useSortable({
    id,
    disabled: shouldDisable,
    data: {
      type: 'component',
      preview,
    },
  });

  // Filter out context menu interfering events and handle them separately
  // IMPORTANT: This hook must be called before any conditional returns!
  const filteredListeners = React.useMemo(() => {
    if (!listeners) return {};

    // Create a copy without onContextMenu to prevent conflicts
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { onContextMenu: _, ...otherListeners } = listeners as Record<
      string,
      unknown
    >;
    return otherListeners;
  }, [listeners]);

  // Conditional rendering after all hooks are called
  if (isDraggingFromPalette) {
    console.log('🚫 SORTABLE RENDERED AS PLAIN DIV:', {
      componentId: id,
      isDraggingFromPalette,
      reason: 'palette dragging - avoiding drop conflicts',
    });

    return (
      <div
        className={cn(className, 'pointer-events-none')}
        style={{ opacity: 0.5 }}
      >
        {children}
      </div>
    );
  }

  // Log component dragging state
  if (isDragging) {
    console.log('🔥 COMPONENT BEING DRAGGED:', {
      componentId: id,
      isDragging,
      transform,
      isDraggingFromPalette,
    });
  }

  // Log if somehow this component is still receiving hover events
  if (isDraggingFromPalette && isOver) {
    console.log('⚠️ SORTABLE STILL HOVERING (Should not happen!):', {
      componentId: id,
      isOver,
      shouldDisable,
      isDraggingFromPalette,
    });
  }

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        className,
        isDragging && 'z-50 scale-105 opacity-60',
        !shouldDisable && 'cursor-grab active:cursor-grabbing'
      )}
      {...filteredListeners}
      {...attributes}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={e => {
        // Call the provided context menu handler if available
        if (onContextMenu) {
          onContextMenu(e);
        }
        // Don't prevent default or stop propagation to ensure proper handling
      }}
      data-component-id={id}
    >
      {children}
    </div>
  );
}

// Sortable Container
interface SortableContainerProps {
  id: string;
  items: string[];
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
  strategy?: SortingStrategy;
}

/**
 * DndKit Sortable Container
 *
 * Provides sortable context for child components
 */
export function SortableContainer({
  id,
  items,
  children,
  className,
  disabled = false,
  strategy = verticalListSortingStrategy,
}: SortableContainerProps) {
  const { isDraggingFromPalette } = useDndState();

  const { isOver, setNodeRef } = useDroppable({
    id,
    disabled,
    data: {
      type: 'container',
      accepts: ['component', 'palette-item'],
    },
  });

  // Log hover events when dragging from palette
  if (isDraggingFromPalette && isOver) {
    console.log('📦 CONTAINER HOVER:', {
      containerId: id,
      isOver,
      isDraggingFromPalette,
      itemCount: items.length,
    });
  }

  return (
    <SortableContext items={items} strategy={strategy}>
      <div
        ref={setNodeRef}
        className={cn(
          className,
          isOver &&
            'ring-opacity-75 bg-stone-50/50 ring-2 ring-stone-400 dark:bg-stone-900/20'
        )}
      >
        {children}
      </div>
    </SortableContext>
  );
}
