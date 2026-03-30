'use client';

import { ComponentType } from '@lib/types/about-page-components';
import { cn } from '@lib/utils';
import {
  AlignLeft,
  Grid3x3,
  Image as ImageIcon,
  Minus,
  MousePointer,
  Palette,
  Type,
} from 'lucide-react';

import React from 'react';

import { Draggable, Droppable } from './dnd-components';

interface ComponentDefinition {
  type: ComponentType;
  name: string;
  icon: React.ReactNode;
  description: string;
  defaultProps: Record<string, unknown>;
  category: 'basic' | 'content' | 'media' | 'layout';
}

const availableComponents: ComponentDefinition[] = [
  {
    type: 'heading',
    name: 'Heading',
    icon: <Type className="h-4 w-4" />,
    description: 'Add headings (H1-H6)',
    defaultProps: {
      content: 'New Heading',
      level: 2,
      textAlign: 'left',
    },
    category: 'basic',
  },
  {
    type: 'paragraph',
    name: 'Paragraph',
    icon: <AlignLeft className="h-4 w-4" />,
    description: 'Add paragraph text',
    defaultProps: {
      content: 'New paragraph text.',
      textAlign: 'left',
    },
    category: 'basic',
  },
  {
    type: 'button',
    name: 'Button',
    icon: <MousePointer className="h-4 w-4" />,
    description: 'Interactive button',
    defaultProps: {
      text: 'Click me',
      variant: 'solid',
      action: 'link',
      url: '#',
    },
    category: 'content',
  },
  {
    type: 'cards',
    name: 'Cards',
    icon: <Grid3x3 className="h-4 w-4" />,
    description: 'Grid or list of cards',
    defaultProps: {
      layout: 'grid',
      items: [
        { title: 'Card 1', description: 'Description for card 1' },
        { title: 'Card 2', description: 'Description for card 2' },
      ],
    },
    category: 'content',
  },
  {
    type: 'image',
    name: 'Image',
    icon: <ImageIcon className="h-4 w-4" />,
    description: 'Add images with captions',
    defaultProps: {
      src: 'https://images.unsplash.com/photo-1486312338219-ce68d2c6f44d?w=400&h=200&fit=crop',
      alt: 'Placeholder Image',
      caption: '',
      alignment: 'center',
      width: 'auto',
      height: 'auto',
    },
    category: 'media',
  },
  {
    type: 'divider',
    name: 'Divider',
    icon: <Minus className="h-4 w-4" />,
    description: 'Horizontal divider line',
    defaultProps: {
      style: 'solid',
      thickness: 'thin',
      color: 'gray',
    },
    category: 'layout',
  },
];

const categories = [
  { id: 'basic' as const, name: 'Basic', icon: <Type className="h-4 w-4" /> },
  {
    id: 'content' as const,
    name: 'Content',
    icon: <Grid3x3 className="h-4 w-4" />,
  },
  {
    id: 'media' as const,
    name: 'Media',
    icon: <ImageIcon className="h-4 w-4" />,
  },
  {
    id: 'layout' as const,
    name: 'Layout',
    icon: <Palette className="h-4 w-4" />,
  },
];

interface ComponentPaletteProps {
  className?: string;
  disabled?: boolean;
}

const ComponentPalette: React.FC<ComponentPaletteProps> = ({
  className,
  disabled = false,
}) => {
  return (
    <div
      className={cn(
        'flex h-0 min-h-full flex-col rounded-lg border',
        'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800',
        className
      )}
    >
      <div className="border-b border-stone-200 p-4 dark:border-stone-700">
        <h3
          className={cn(
            'flex items-center gap-2 text-lg font-medium',
            'text-stone-900 dark:text-stone-100'
          )}
        >
          <Palette className="h-5 w-5" />
          Components
        </h3>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-0">
        {disabled && (
          <div className="px-4 pt-4 text-xs text-stone-500 dark:text-stone-400">
            Structure is locked for non-English locales. Switch to `en-US` to
            add, remove, or reorder content blocks.
          </div>
        )}
        <Droppable
          id="component-palette"
          disabled={true}
          className="space-y-6 px-4 pb-4"
        >
          {categories.map(category => {
            const categoryComponents = availableComponents.filter(
              comp => comp.category === category.id
            );

            if (categoryComponents.length === 0) return null;

            return (
              <div key={category.id} className="space-y-2">
                <h3
                  className={cn(
                    'flex items-center gap-2 text-sm font-medium',
                    'text-stone-600 dark:text-stone-400'
                  )}
                >
                  {category.icon}
                  {category.name}
                </h3>
                <div className="space-y-2">
                  {categoryComponents.map(comp => {
                    const componentPreview = (
                      <div
                        className={cn(
                          'flex cursor-grab items-center gap-3 rounded-md border p-3 transition-colors active:cursor-grabbing',
                          'border-stone-200 bg-stone-50 hover:border-stone-300 hover:bg-stone-100',
                          'dark:border-stone-600 dark:bg-stone-700 dark:hover:border-stone-500 dark:hover:bg-stone-600'
                        )}
                      >
                        <div
                          className={cn(
                            'flex-shrink-0',
                            'text-stone-600 dark:text-stone-400'
                          )}
                        >
                          {comp.icon}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p
                            className={cn(
                              'truncate text-sm font-medium',
                              'text-stone-900 dark:text-stone-100'
                            )}
                          >
                            {comp.name}
                          </p>
                          <p
                            className={cn(
                              'truncate text-xs',
                              'text-stone-600 dark:text-stone-400'
                            )}
                          >
                            {comp.description}
                          </p>
                        </div>
                      </div>
                    );

                    return (
                      <Draggable
                        key={comp.type}
                        id={`palette-${comp.type}`}
                        preview={componentPreview}
                        disabled={disabled}
                      >
                        {componentPreview}
                      </Draggable>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </Droppable>
      </div>
    </div>
  );
};

export default ComponentPalette;
export { availableComponents };
