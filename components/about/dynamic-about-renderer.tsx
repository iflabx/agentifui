'use client';

import ComponentRenderer from '@components/admin/content/component-renderer';
import type {
  AboutTranslationData,
  PageContent,
} from '@lib/types/about-page-components';
import {
  isDynamicFormat,
  migrateAboutTranslationData,
} from '@lib/types/about-page-components';
import { cn } from '@lib/utils';
import { AnimatePresence, motion } from 'framer-motion';

import React from 'react';

interface DynamicAboutRendererProps {
  /**
   * Translation data for the about page (legacy or dynamic format)
   */
  translationData: AboutTranslationData;
  /**
   * Handle button click action
   */
  onButtonClick?: (url?: string) => void;
}

/**
 * Dynamic About Page Renderer
 *
 * Renders about page content using dynamic component structure
 * Falls back to legacy structure if dynamic data is not available
 */
export function DynamicAboutRenderer({
  translationData,
}: DynamicAboutRendererProps) {
  // Ensure we have dynamic format data
  const dynamicData = React.useMemo(() => {
    if (!isDynamicFormat(translationData)) {
      return migrateAboutTranslationData(translationData);
    }
    return translationData;
  }, [translationData]);

  // Create page content from translation data
  const pageContent: PageContent = React.useMemo(() => {
    return {
      sections: Array.isArray(dynamicData.sections) ? dynamicData.sections : [],
      metadata: dynamicData.metadata || {
        version: '1.0.0',
        lastModified: new Date().toISOString(),
        author: 'frontend',
      },
    };
  }, [dynamicData]);

  /**
   * Render page sections with homepage-style animations and layout
   */
  const renderSections = () => {
    if (!pageContent.sections || pageContent.sections.length === 0) {
      return (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="flex h-64 items-center justify-center text-gray-300 dark:text-stone-700"
        >
          <p>No content to display</p>
        </motion.div>
      );
    }

    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6 }}
        className="space-y-16"
      >
        {pageContent.sections.map((section, sectionIndex) => (
          <motion.section
            key={section.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{
              duration: 0.6,
              delay: 0.1 + sectionIndex * 0.1,
            }}
            className="w-full"
          >
            <div
              className={cn(
                'gap-8',
                section.layout === 'single-column' && 'space-y-8',
                section.layout === 'two-column' &&
                  'grid grid-cols-1 md:grid-cols-2',
                section.layout === 'three-column' &&
                  'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3'
              )}
            >
              {section.columns.map((column, columnIndex) => (
                <div key={columnIndex} className="space-y-8">
                  {column.map((component, componentIndex) => (
                    <motion.div
                      key={component.id}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.5,
                        delay: 0.2 + sectionIndex * 0.1 + componentIndex * 0.05,
                      }}
                    >
                      <ComponentRenderer
                        component={component}
                        sectionCommonProps={section.commonProps}
                      />
                    </motion.div>
                  ))}
                </div>
              ))}
            </div>
          </motion.section>
        ))}
      </motion.div>
    );
  };

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.6 }}
      >
        {renderSections()}
      </motion.div>
    </AnimatePresence>
  );
}
