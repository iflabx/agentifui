/**
 * Data Migration Tool
 *
 * Provides functionality to migrate from a fixed structure to a dynamic component structure.
 */
import {
  AboutTranslationData,
  ComponentInstance,
  ComponentType,
  IdPrefix,
  LegacyAboutData,
  PageContent,
  PageSection,
} from '@lib/types/about-page-components';

// Re-export types for use in other modules
export type {
  LegacyAboutData,
  AboutTranslationData,
  PageContent,
  PageSection,
  ComponentInstance,
  ComponentType,
  IdPrefix,
} from '@lib/types/about-page-components';

// Home page data structure interface
export interface LegacyHomeData {
  title?: string;
  subtitle?: string;
  getStarted?: string;
  learnMore?: string;
  features?: Array<{
    title: string;
    description: string;
  }>;
  copyright?: {
    prefix?: string;
    linkText?: string;
    suffix?: string;
  };
}

// Extended home page translation data interface, supporting a dynamic component structure
export interface HomeTranslationData {
  // New dynamic component structure
  sections?: PageSection[];

  // Backward compatibility: Retain the original fixed structure (for data migration)
  title?: string;
  subtitle?: string;
  getStarted?: string;
  learnMore?: string;
  features?: Array<{
    title: string;
    description: string;
  }>;
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

// ID generation function
export function generateUniqueId(prefix: IdPrefix): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 9);
  return `${prefix}-${timestamp}-${random}`;
}

// Generate multiple unique IDs
export function generateUniqueIds(prefix: IdPrefix, count: number): string[] {
  return Array.from({ length: count }, () => generateUniqueId(prefix));
}

// Create a default component instance
export function createDefaultComponent(
  type: ComponentType,
  content?: string
): ComponentInstance {
  const id = generateUniqueId('comp');

  const defaultProps: Record<ComponentType, Record<string, unknown>> = {
    heading: {
      content: content || 'New Heading',
      level: 2,
      textAlign: 'left',
    },
    paragraph: {
      content: content || 'New paragraph text',
      textAlign: 'left',
    },
    button: {
      text: content || 'New Button',
      variant: 'solid',
      action: 'link',
      url: '#',
    },
    cards: {
      layout: 'grid',
      items: [],
    },
    image: {
      src: '',
      alt: content || 'Image',
      alignment: 'center',
      width: 'auto',
      height: 'auto',
    },
    divider: {
      style: 'solid',
      color: 'gray',
      thickness: 'medium',
    },
  };

  return {
    id,
    type,
    props: defaultProps[type] || {},
    // Inherit section properties by default
    inheritFromSection: true,
    overrideProps: [],
  };
}

// Create a default section
export function createDefaultSection(
  layout: 'single-column' | 'two-column' | 'three-column' = 'single-column'
): PageSection {
  const id = generateUniqueId('section');
  const columnCount =
    layout === 'single-column' ? 1 : layout === 'two-column' ? 2 : 3;

  return {
    id,
    layout,
    columns: Array(columnCount)
      .fill([])
      .map(() => []),
    // Default common properties for the section
    commonProps: {
      theme: 'auto',
      spacing: 'normal',
      textAlign: 'left',
      animation: 'none',
      interactive: true,
      dragBehavior: 'inherit',
    },
  };
}

// Migrate from a fixed structure to a dynamic component structure
export function migrateLegacyToSections(legacy: LegacyAboutData): PageContent {
  const sections: PageSection[] = [];

  // Title and subtitle section
  if (legacy.title || legacy.subtitle) {
    const titleComponents: ComponentInstance[] = [];

    if (legacy.title) {
      titleComponents.push(createDefaultComponent('heading', legacy.title));
      titleComponents[titleComponents.length - 1].props.level = 1;
      titleComponents[titleComponents.length - 1].props.textAlign = 'center';
    }

    if (legacy.subtitle) {
      titleComponents.push(
        createDefaultComponent('paragraph', legacy.subtitle)
      );
      titleComponents[titleComponents.length - 1].props.textAlign = 'center';
    }

    if (titleComponents.length > 0) {
      sections.push({
        id: generateUniqueId('section'),
        layout: 'single-column',
        columns: [titleComponents],
      });
    }
  }

  // Mission section
  if (legacy.mission?.description) {
    sections.push({
      id: generateUniqueId('section'),
      layout: 'single-column',
      columns: [
        [
          createDefaultComponent('heading', 'Our Mission'),
          createDefaultComponent('paragraph', legacy.mission.description),
        ],
      ],
    });
  }

  // Values section
  if (legacy.values?.items && legacy.values.items.length > 0) {
    const valuesSection: PageSection = {
      id: generateUniqueId('section'),
      layout: 'single-column',
      columns: [[createDefaultComponent('heading', 'Our Values')]],
    };

    // Add cards component
    const cardsComponent = createDefaultComponent('cards');
    cardsComponent.props = {
      layout: 'grid',
      items: legacy.values.items,
    };

    valuesSection.columns[0].push(cardsComponent);
    sections.push(valuesSection);
  }

  // Button section
  if (legacy.buttonText) {
    const buttonComponent = createDefaultComponent('button', legacy.buttonText);
    buttonComponent.props.textAlign = 'center';
    sections.push({
      id: generateUniqueId('section'),
      layout: 'single-column',
      columns: [[buttonComponent]],
    });
  }

  // Copyright section
  if (legacy.copyright) {
    const copyrightText = [
      legacy.copyright.prefix?.replace(
        '{year}',
        new Date().getFullYear().toString()
      ) || '',
      legacy.copyright.linkText || '',
      legacy.copyright.suffix || '',
    ].join('');

    if (copyrightText.trim()) {
      const copyrightComponent = createDefaultComponent(
        'paragraph',
        copyrightText
      );
      copyrightComponent.props.textAlign = 'center';

      sections.push({
        id: generateUniqueId('section'),
        layout: 'single-column',
        columns: [[copyrightComponent]],
      });
    }
  }

  return {
    sections,
    metadata: {
      version: '1.0.0',
      lastModified: new Date().toISOString(),
      author: 'system-migration',
    },
  };
}

// Migrate complete translation data
export function migrateAboutTranslationData(
  legacy: AboutTranslationData
): AboutTranslationData {
  // If it's already in the dynamic format, return directly
  if (Array.isArray(legacy.sections) && legacy.sections.length > 0) {
    return legacy;
  }

  // Migrate the fixed structure to the dynamic structure
  const pageContent = migrateLegacyToSections(legacy);

  return {
    sections: pageContent.sections,
    metadata: {
      ...legacy.metadata,
      ...pageContent.metadata,
      migrated: true,
    },
  };
}

// Batch migrate multi-language data
export function batchMigrateTranslations(
  translations: Record<string, AboutTranslationData>
): Record<string, AboutTranslationData> {
  const migratedTranslations: Record<string, AboutTranslationData> = {};

  for (const [locale, data] of Object.entries(translations)) {
    migratedTranslations[locale] = migrateAboutTranslationData(data);
  }

  return migratedTranslations;
}

// Validate the integrity of the migrated data
export function validateMigratedData(data: AboutTranslationData): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check if sections exist
  if (!data.sections || data.sections.length === 0) {
    errors.push('Migrated data is missing sections');
  }

  // Check the integrity of each section
  data.sections?.forEach((section: PageSection, index: number) => {
    if (!section.id) {
      errors.push(`Section ${index} is missing an ID`);
    }

    if (!section.layout) {
      errors.push(`Section ${index} is missing a layout configuration`);
    }

    if (!section.columns || !Array.isArray(section.columns)) {
      errors.push(`Section ${index} has missing or invalid columns`);
    }

    // Check component integrity
    section.columns?.forEach(
      (column: ComponentInstance[], columnIndex: number) => {
        if (!Array.isArray(column)) {
          errors.push(
            `Section ${index}, Column ${columnIndex} is not an array`
          );
          return;
        }

        column.forEach((component, componentIndex) => {
          if (!component.id) {
            errors.push(
              `Section ${index}, Column ${columnIndex}, Component ${componentIndex} is missing an ID`
            );
          }

          if (!component.type) {
            errors.push(
              `Section ${index}, Column ${columnIndex}, Component ${componentIndex} is missing a type`
            );
          }

          if (!component.props) {
            errors.push(
              `Section ${index}, Column ${columnIndex}, Component ${componentIndex} is missing props`
            );
          }
        });
      }
    );
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// === Home Page Data Migration Functions ===

// Check if the home page data is in the new dynamic format
export function isHomeDynamicFormat(data: HomeTranslationData): boolean {
  return Boolean(data && data.sections && data.sections.length > 0);
}

// Check if the home page data is in the old fixed format
export function isHomeLegacyFormat(data: HomeTranslationData): boolean {
  return Boolean(
    !data.sections &&
      (data.title ||
        data.subtitle ||
        data.getStarted ||
        data.learnMore ||
        data.features)
  );
}

// Migrate from the home page's fixed structure to a dynamic component structure
export function migrateHomeLegacyToSections(
  legacy: LegacyHomeData
): PageContent {
  const sections: PageSection[] = [];

  // Title and subtitle section
  if (legacy.title || legacy.subtitle) {
    const titleComponents: ComponentInstance[] = [];

    if (legacy.title) {
      titleComponents.push(createDefaultComponent('heading', legacy.title));
      titleComponents[titleComponents.length - 1].props.level = 1;
      titleComponents[titleComponents.length - 1].props.textAlign = 'center';
    }

    if (legacy.subtitle) {
      titleComponents.push(
        createDefaultComponent('paragraph', legacy.subtitle)
      );
      titleComponents[titleComponents.length - 1].props.textAlign = 'center';
    }

    if (titleComponents.length > 0) {
      sections.push({
        id: generateUniqueId('section'),
        layout: 'single-column',
        columns: [titleComponents],
      });
    }
  }

  // Features cards section
  if (legacy.features && legacy.features.length > 0) {
    const cardsComponent = createDefaultComponent('cards');
    cardsComponent.props = {
      layout: 'grid',
      items: legacy.features,
    };

    sections.push({
      id: generateUniqueId('section'),
      layout: 'single-column',
      columns: [[cardsComponent]],
    });
  }

  // Double button section
  if (legacy.getStarted || legacy.learnMore) {
    const buttonComponent = createDefaultComponent(
      'button',
      legacy.getStarted || 'Get Started'
    );

    // If there are two buttons, use the double button feature
    if (legacy.getStarted && legacy.learnMore) {
      buttonComponent.props = {
        text: legacy.getStarted,
        variant: 'solid',
        action: 'link',
        url: '/chat',
        secondaryButton: {
          text: legacy.learnMore,
          variant: 'outline',
          action: 'link',
          url: '/about',
        },
      };
    } else {
      // Single button
      buttonComponent.props = {
        text: legacy.getStarted || legacy.learnMore,
        variant: 'solid',
        action: 'link',
        url: legacy.getStarted ? '/chat' : '/about',
      };
    }

    sections.push({
      id: generateUniqueId('section'),
      layout: 'single-column',
      columns: [[buttonComponent]],
    });
  }

  // Copyright section
  if (legacy.copyright) {
    const copyrightText = [
      legacy.copyright.prefix?.replace(
        '{year}',
        new Date().getFullYear().toString()
      ) || '',
      legacy.copyright.linkText || '',
      legacy.copyright.suffix || '',
    ].join('');

    if (copyrightText.trim()) {
      const copyrightComponent = createDefaultComponent(
        'paragraph',
        copyrightText
      );
      copyrightComponent.props.textAlign = 'center';

      sections.push({
        id: generateUniqueId('section'),
        layout: 'single-column',
        columns: [[copyrightComponent]],
      });
    }
  }

  return {
    sections,
    metadata: {
      version: '1.0.0',
      lastModified: new Date().toISOString(),
      author: 'system-migration',
    },
  };
}

// Migrate complete home page translation data
export function migrateHomeTranslationData(
  legacy: HomeTranslationData
): HomeTranslationData {
  // If it's already in the dynamic format, return directly
  if (legacy.sections && legacy.sections.length > 0) {
    return legacy;
  }

  // Migrate the fixed structure to the dynamic structure
  const pageContent = migrateHomeLegacyToSections(legacy);

  return {
    sections: pageContent.sections,
    metadata: {
      ...legacy.metadata,
      ...pageContent.metadata,
      migrated: true,
    },
  };
}

// Batch migrate multi-language home page data
export function batchMigrateHomeTranslations(
  translations: Record<string, HomeTranslationData>
): Record<string, HomeTranslationData> {
  const migratedTranslations: Record<string, HomeTranslationData> = {};

  for (const [locale, data] of Object.entries(translations)) {
    migratedTranslations[locale] = migrateHomeTranslationData(data);
  }

  return migratedTranslations;
}

// Validate the integrity of the migrated home page data
export function validateHomeMigratedData(data: HomeTranslationData): {
  isValid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check if sections exist
  if (!data.sections || data.sections.length === 0) {
    errors.push('Migrated home page data is missing sections');
  }

  // Check the integrity of each section
  data.sections?.forEach((section: PageSection, index: number) => {
    if (!section.id) {
      errors.push(`Home page Section ${index} is missing an ID`);
    }

    if (!section.layout) {
      errors.push(
        `Home page Section ${index} is missing a layout configuration`
      );
    }

    if (!section.columns || !Array.isArray(section.columns)) {
      errors.push(`Home page Section ${index} has missing or invalid columns`);
    }

    // Check component integrity
    section.columns?.forEach(
      (column: ComponentInstance[], columnIndex: number) => {
        if (!Array.isArray(column)) {
          errors.push(
            `Home page Section ${index}, Column ${columnIndex} is not an array`
          );
          return;
        }

        column.forEach((component, componentIndex) => {
          if (!component.id) {
            errors.push(
              `Home page Section ${index}, Column ${columnIndex}, Component ${componentIndex} is missing an ID`
            );
          }

          if (!component.type) {
            errors.push(
              `Home page Section ${index}, Column ${columnIndex}, Component ${componentIndex} is missing a type`
            );
          }

          if (!component.props) {
            errors.push(
              `Home page Section ${index}, Column ${columnIndex}, Component ${componentIndex} is missing props`
            );
          }
        });
      }
    );
  });

  return {
    isValid: errors.length === 0,
    errors,
  };
}

// Create backup data
export function createBackupData(data: AboutTranslationData): {
  data: AboutTranslationData;
  timestamp: string;
  version: string;
} {
  return {
    data: JSON.parse(JSON.stringify(data)), // Deep copy
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  };
}

// Create home page backup data
export function createHomeBackupData(data: HomeTranslationData): {
  data: HomeTranslationData;
  timestamp: string;
  version: string;
} {
  return {
    data: JSON.parse(JSON.stringify(data)), // Deep copy
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  };
}
