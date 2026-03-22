/**
 * Dynamic "About" Page Component Type Definitions
 *
 * This file defines all the types required for the dynamic component editor, including:
 * - Component type enums
 * - Layout type enums
 * - Component instance structure
 * - Page section structure
 * - Page content structure
 * - Prop interface definitions for various components
 */

// Supported layout types
export type LayoutType = 'single-column' | 'two-column' | 'three-column';

// Supported component types
export type ComponentType =
  | 'heading'
  | 'paragraph'
  | 'cards'
  | 'button'
  | 'image'
  | 'divider';

// Component instance interface
export interface ComponentInstance {
  id: string;
  type: ComponentType;
  props: Record<string, unknown>;
  // Whether to inherit shared properties from the section (defaults to true)
  inheritFromSection?: boolean;
  // List of section property keys to override
  overrideProps?: string[];
}

// Section shared properties interface
export interface SectionCommonProps {
  // Style theme
  theme?: 'light' | 'dark' | 'auto';
  // Spacing settings
  spacing?: 'compact' | 'normal' | 'spacious';
  // Text alignment
  textAlign?: 'left' | 'center' | 'right';
  // Animation effect
  animation?: 'fade' | 'slide' | 'none';
  // Whether it is interactive
  interactive?: boolean;
  // Drag behavior
  dragBehavior?: 'inherit' | 'custom';
  // Background style
  backgroundColor?: string;
  // Border style
  borderStyle?: 'none' | 'solid' | 'dashed' | 'dotted';
  // Custom property extension
  customProps?: Record<string, unknown>;
}

// Page section interface
export interface PageSection {
  id: string;
  layout: LayoutType;
  columns: ComponentInstance[][];
  shouldDelete?: boolean;
  // New: Section-level shared properties
  commonProps?: SectionCommonProps;
}

// Page content interface
export interface PageContent {
  sections: PageSection[];
  metadata?: {
    version?: string;
    lastModified?: string;
    author?: string;
  };
}

// === Component Props Interface Definitions ===

// Heading component Props
export interface HeadingProps {
  content: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  textAlign: 'left' | 'center' | 'right';
}

// Paragraph component Props
export interface ParagraphProps {
  content: string;
  textAlign: 'left' | 'center' | 'right';
}

// Cards component Props
export interface CardsProps {
  layout: 'grid' | 'list';
  items: Array<{
    title: string;
    description: string;
    icon?: string;
  }>;
}

// Button component Props
export interface ButtonProps {
  text: string;
  variant: 'solid' | 'outline';
  action: 'link' | 'submit' | 'external';
  url?: string;
  // Optional second button
  secondaryButton?: {
    text: string;
    variant: 'solid' | 'outline';
    action: 'link' | 'submit' | 'external';
    url?: string;
  };
}

// Image component Props
export interface ImageProps {
  src: string;
  alt: string;
  caption?: string;
  alignment: 'left' | 'center' | 'right';
  width?: string | number;
  height?: string | number;
}

// Divider component Props
export interface DividerProps {
  style: 'solid' | 'dashed' | 'dotted';
  color?: string;
  thickness?: 'thin' | 'medium' | 'thick';
}

// Component Props union type
export type ComponentProps =
  | HeadingProps
  | ParagraphProps
  | CardsProps
  | ButtonProps
  | ImageProps
  | DividerProps;

// Component definition interface (for the component registration system)
export interface ComponentDefinition {
  type: ComponentType;
  name: string;
  icon: string;
  defaultProps: Record<string, unknown>;
  category: 'basic' | 'layout' | 'content' | 'media';
  description?: string;
}

// Editor state interface
export interface AboutEditorState {
  pageContent: PageContent | null;
  selectedComponentId: string | null;
  undoStack: PageContent[];
  redoStack: PageContent[];
  isDirty: boolean;
  isLoading: boolean;
}

// Drag result interface (from react-beautiful-dnd)
export interface DragResult {
  draggableId: string;
  type: string;
  source: {
    droppableId: string;
    index: number;
  };
  destination?: {
    droppableId: string;
    index: number;
  } | null;
}

// ID generation related types
export type IdPrefix = 'section' | 'comp';

// Data migration related interfaces
export interface LegacyAboutData {
  title?: string;
  subtitle?: string;
  mission?: {
    description?: string;
  };
  values?: {
    items?: Array<{
      title: string;
      description: string;
    }>;
  };
  buttonText?: string;
  copyright?: {
    prefix?: string;
    linkText?: string;
    suffix?: string;
  };
}

// Extended "About" translation data interface, supporting dynamic component structure
export interface AboutTranslationData {
  // New dynamic component structure
  sections?: PageSection[];

  // Backward compatibility: Retain the original fixed structure (for data migration)
  title?: string;
  subtitle?: string;
  mission?: {
    description?: string;
  };
  values?: {
    items?: Array<{
      title: string;
      description: string;
    }>;
  };
  buttonText?: string;
  copyright?: {
    prefix?: string;
    linkText?: string;
    suffix?: string;
  };

  // Metadata
  metadata?: {
    version?: string;
    lastModified?: string;
    author?: string;
    migrated?: boolean; // Flag to indicate if migration from fixed to dynamic structure has occurred
  };
}

// Checks if the data is in the new dynamic format
export function isDynamicFormat(data: AboutTranslationData): boolean {
  return Boolean(
    data && Array.isArray(data.sections) && data.sections.length > 0
  );
}

// Checks if the data is in the old legacy format
export function isLegacyFormat(data: AboutTranslationData): boolean {
  return Boolean(
    !Array.isArray(data.sections) &&
      (data.title ||
        data.subtitle ||
        data.mission ||
        data.values ||
        data.buttonText)
  );
}

// Re-export utility functions from data-migration for convenience
export {
  generateUniqueId,
  createDefaultComponent,
  createDefaultSection,
  migrateLegacyToSections,
  migrateAboutTranslationData,
  batchMigrateTranslations,
  validateMigratedData,
  createBackupData,
} from '@lib/utils/data-migration';

// === Property Inheritance Utility Functions ===

/**
 * Merges section common properties and component-specific properties
 *
 * @param sectionCommonProps - Section-level common properties
 * @param componentProps - Component-specific properties
 * @param overrideProps - List of common property keys to override
 * @returns The merged final properties object
 */
export function mergeComponentProps(
  sectionCommonProps: SectionCommonProps = {},
  componentProps: Record<string, unknown> = {},
  overrideProps: string[] = []
): Record<string, unknown> {
  // Extract known properties and customProps from sectionCommonProps
  const { customProps, ...knownSectionProps } = sectionCommonProps;

  // Create a copy of all section properties (known + custom)
  const allSectionProps = {
    ...knownSectionProps,
    ...(customProps || {}),
  };

  // Create inherited properties by removing overridden ones
  const inherited = Object.fromEntries(
    Object.entries(allSectionProps).filter(
      ([key]) => !overrideProps.includes(key)
    )
  );

  // Component-specific properties have higher priority
  return {
    ...inherited,
    ...componentProps,
  };
}

/**
 * Gets the final resolved properties for a component (including inheritance logic)
 *
 * @param component - The component instance
 * @param sectionCommonProps - The common properties of the section
 * @returns The resolved final properties object
 */
export function getResolvedComponentProps(
  component: ComponentInstance,
  sectionCommonProps?: SectionCommonProps
): Record<string, unknown> {
  // If not inheriting or no section common props exist, return component props directly
  if (component.inheritFromSection === false || !sectionCommonProps) {
    return component.props;
  }

  // Merge properties (default inheritance)
  return mergeComponentProps(
    sectionCommonProps,
    component.props,
    component.overrideProps || []
  );
}
