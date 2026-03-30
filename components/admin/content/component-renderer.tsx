'use client';

import {
  CardsProps,
  ComponentInstance,
  DividerProps,
  ButtonProps as DynamicButtonProps,
  HeadingProps,
  ImageProps,
  ParagraphProps,
  SectionCommonProps,
  getResolvedComponentProps,
} from '@lib/types/about-page-components';
import { cn } from '@lib/utils';
import { resolveContentVariablesDeep } from '@lib/utils/text-processing';

import React from 'react';

import { useLocale } from 'next-intl';

/**
 * Heading component renderer
 *
 * Renders heading elements with homepage-style gradients and styling
 */
const Heading: React.FC<HeadingProps> = ({ content, level, textAlign }) => {
  const textAlignClasses = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  const alignmentClass = textAlignClasses[textAlign];

  // Define font sizes for different heading levels with responsive design
  const sizeClasses = {
    1: 'text-5xl md:text-6xl',
    2: 'text-3xl sm:text-4xl md:text-5xl',
    3: 'text-2xl sm:text-3xl md:text-4xl',
    4: 'text-xl sm:text-2xl md:text-3xl',
    5: 'text-lg sm:text-xl md:text-2xl',
    6: 'text-base sm:text-lg md:text-xl',
  };

  // Apply gradient for large headings (H1, H2)
  const shouldUseGradient = level <= 2;

  if (shouldUseGradient) {
    return React.createElement(
      `h${level}`,
      {
        className: cn(
          'bg-gradient-to-r from-stone-700 to-stone-900 dark:from-stone-300 dark:to-stone-500',
          'mb-6 bg-clip-text py-3 leading-normal font-bold text-transparent',
          sizeClasses[level],
          alignmentClass
        ),
      },
      content
    );
  }

  return React.createElement(
    `h${level}`,
    {
      className: cn(
        'mb-4 font-bold text-stone-900 sm:mb-6 dark:text-stone-100',
        sizeClasses[level],
        alignmentClass
      ),
    },
    content
  );
};

/**
 * Paragraph component renderer
 *
 * Renders paragraph text with stone color system styling
 */
const Paragraph: React.FC<ParagraphProps> = ({ content, textAlign }) => {
  const textAlignClasses = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  return (
    <p
      className={cn(
        'mb-4 text-lg leading-relaxed font-light text-stone-700 md:text-xl dark:text-stone-300',
        'mx-auto max-w-3xl',
        textAlignClasses[textAlign]
      )}
    >
      {content}
    </p>
  );
};

/**
 * Cards component renderer
 *
 * Renders a grid or list of cards with homepage-inspired shadows and stone color system
 */
const Cards: React.FC<
  CardsProps & { previewDevice?: 'desktop' | 'tablet' | 'mobile' }
> = ({ items, layout, previewDevice = 'desktop' }) => {
  // Determine grid layout based on layout prop and preview device
  const getGridClass = () => {
    if (layout !== 'grid') return 'grid-cols-1';

    // For mobile preview, always use single column
    if (previewDevice === 'mobile') return 'grid-cols-1';

    // For desktop and tablet, use responsive two-column layout
    return 'md:grid-cols-2';
  };

  const gridClass = getGridClass();

  return (
    <div className={cn('mb-6 grid grid-cols-1 gap-4 sm:gap-6', gridClass)}>
      {items.map((item, index) => (
        <div
          key={index}
          className={cn(
            'flex flex-col items-center rounded-xl p-4 text-center transition-all duration-200 sm:p-6',
            'border border-stone-200 bg-stone-100 shadow-[0_4px_20px_rgba(0,0,0,0.1)]',
            'hover:-translate-y-1 hover:shadow-[0_6px_25px_rgba(0,0,0,0.15)]',
            'dark:border-stone-600 dark:bg-stone-700 dark:shadow-[0_4px_20px_rgba(0,0,0,0.3)]',
            'dark:hover:shadow-[0_6px_25px_rgba(0,0,0,0.4)]'
          )}
        >
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-stone-200 dark:bg-stone-600">
            <span className="text-xl text-stone-600 dark:text-stone-300">
              #{index + 1}
            </span>
          </div>
          <h3 className="mb-2 text-base font-semibold text-stone-900 sm:text-lg dark:text-stone-100">
            {item.title}
          </h3>
          <p className="text-sm leading-relaxed text-stone-700 sm:text-base dark:text-stone-300">
            {item.description}
          </p>
        </div>
      ))}
    </div>
  );
};

/**
 * Button component renderer
 *
 * Renders interactive buttons with stone color system variants
 * Supports dual button layout with homepage-style spacing
 */
const DynamicButton: React.FC<DynamicButtonProps> = ({
  text,
  variant,
  action,
  url,
  secondaryButton,
}) => {
  const handleClick = (
    e: React.MouseEvent,
    buttonAction?: string,
    buttonUrl?: string
  ) => {
    if (buttonAction === 'link' && buttonUrl === '#') {
      e.preventDefault();
      // In preview mode, prevent default action
    }
  };

  const buttonStyles = {
    solid: cn(
      'inline-flex items-center justify-center rounded-lg px-8 py-3 text-base font-medium transition-all duration-200',
      'min-w-[8rem] bg-stone-900 text-white hover:scale-105 hover:bg-stone-800 focus:ring-2 focus:ring-stone-500 focus:ring-offset-2 focus:outline-none',
      'dark:bg-stone-100 dark:text-stone-900 dark:hover:bg-stone-200 dark:focus:ring-stone-400'
    ),
    outline: cn(
      'inline-flex items-center justify-center rounded-lg px-8 py-3 text-base font-medium transition-all duration-200',
      'min-w-[8rem] border border-stone-300 bg-transparent text-stone-900 hover:scale-105 hover:bg-stone-50 focus:ring-2 focus:ring-stone-500 focus:ring-offset-2 focus:outline-none',
      'dark:border-stone-600 dark:text-stone-100 dark:hover:bg-stone-800 dark:focus:ring-stone-400'
    ),
  };

  return (
    <div className="mb-6 flex flex-wrap justify-center gap-4">
      <a
        href={url || '#'}
        onClick={e => handleClick(e, action, url)}
        className={buttonStyles[variant]}
      >
        {text}
      </a>
      {secondaryButton && (
        <a
          href={secondaryButton.url || '#'}
          onClick={e =>
            handleClick(e, secondaryButton.action, secondaryButton.url)
          }
          className={buttonStyles[secondaryButton.variant]}
        >
          {secondaryButton.text}
        </a>
      )}
    </div>
  );
};

/**
 * Image component renderer
 *
 * Renders images with captions and alignment
 */
const Image: React.FC<ImageProps> = ({
  src,
  alt,
  caption,
  alignment,
  width,
  height,
}) => {
  const alignmentClasses = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };

  const imageStyle: React.CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    maxWidth: '100%',
  };

  return (
    <div className={cn('mb-6', alignmentClasses[alignment])}>
      <img
        src={src}
        alt={alt}
        style={imageStyle}
        className="inline-block rounded-lg shadow-sm"
      />
      {caption && (
        <p className="text-muted-foreground mt-2 text-sm italic">{caption}</p>
      )}
    </div>
  );
};

/**
 * Divider component renderer
 *
 * Renders horizontal dividers with different styles
 */
const Divider: React.FC<DividerProps> = ({ style, thickness, color }) => {
  let borderStyle = 'border-solid';
  if (style === 'dashed') borderStyle = 'border-dashed';
  if (style === 'dotted') borderStyle = 'border-dotted';

  let borderThickness = 'border-t';
  if (thickness === 'medium') borderThickness = 'border-t-2';
  if (thickness === 'thick') borderThickness = 'border-t-4';

  const borderColor = color ? `border-${color}-300` : 'border-border';

  return (
    <hr className={cn(borderStyle, borderThickness, borderColor, 'my-6')} />
  );
};

/**
 * Component type to React component mapping
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const componentMap: Record<string, React.FC<any>> = {
  heading: Heading,
  paragraph: Paragraph,
  cards: Cards,
  button: DynamicButton,
  image: Image,
  divider: Divider,
};

/**
 * Main component renderer
 *
 * Dynamically renders components based on their type
 */
interface ComponentRendererProps {
  component: ComponentInstance;
  className?: string;
  sectionCommonProps?: SectionCommonProps;
  previewDevice?: 'desktop' | 'tablet' | 'mobile';
}

const ComponentRenderer: React.FC<ComponentRendererProps> = ({
  component,
  className,
  sectionCommonProps,
  previewDevice = 'desktop',
}) => {
  const Component = componentMap[component.type];
  const locale = useLocale();

  if (!Component) {
    // Fallback for unregistered components
    return (
      <div
        className={cn(
          'border-destructive/50 bg-destructive/10 text-destructive rounded-lg border p-4 text-center',
          className
        )}
      >
        <p className="font-medium">
          Component type &quot;{component.type}&quot; not found.
        </p>
        <p className="text-sm">Please check the component registration.</p>
      </div>
    );
  }

  // Final properties after merge (including inheritance logic)
  const resolvedProps = getResolvedComponentProps(
    component,
    sectionCommonProps
  );
  const localizedProps = resolveContentVariablesDeep(resolvedProps, locale);

  // Add previewDevice to props if component supports it
  const componentProps =
    component.type === 'cards'
      ? { ...localizedProps, previewDevice }
      : localizedProps;

  return (
    <div className={className}>
      <Component {...componentProps} />
    </div>
  );
};

export default ComponentRenderer;
