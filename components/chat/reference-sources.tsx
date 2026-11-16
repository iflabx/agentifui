import { cn } from '@lib/utils';

import React, { useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  ChevronDownIcon,
  ChevronUpIcon,
  ClipboardDocumentIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';

import { SourceListItem } from './source-list';

interface RetrieverResource {
  dataset_name: string;
  document_name: string;
  content: string;
  score: number;
  position: number;
  word_count?: number; // Make this field optional for compatibility with different Dify apps
  page?: number | null;
  dataset_id?: string;
  segment_id?: string;
  document_id?: string;
}

interface ReferenceSourcesProps {
  retrieverResources?: RetrieverResource[];
  className?: string;
  animationDelay?: number;
}

export function ReferenceSources({
  retrieverResources,
  className,
  animationDelay = 0,
}: ReferenceSourcesProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const t = useTranslations('components.chat.referenceSources');

  // If there are no reference resources, do not render the component
  if (!retrieverResources || retrieverResources.length === 0) {
    return null;
  }

  // Toggle the expansion of the reference list
  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  // Toggle the expansion of a single item
  const toggleItemExpanded = (index: number) => {
    setExpandedIndex(expandedIndex === index ? null : index);
  };

  // Copy content to clipboard
  const handleCopy = async (content: string, index: number) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch (err) {
      console.error(t('copyFailed'), err);
    }
  };

  // Format the relevance score as a percentage
  const formatScore = (score: number) => {
    return (score * 100).toFixed(1) + '%';
  };

  // Get a preview of the content for summary
  const getContentPreview = (content: string, maxLength = 100) => {
    if (content.length <= maxLength) return content;
    return content.slice(0, maxLength) + '...';
  };

  return (
    <div className={cn('w-full', className)}>
      {/* Header bar */}
      <button
        onClick={toggleExpanded}
        className={cn(
          'flex w-full items-center justify-between px-3 py-1.5',
          'rounded border transition-colors duration-150',
          'focus:outline-none',
          'animate-fade-in opacity-0',
          'border-stone-300/70 bg-stone-100/90 text-stone-800 hover:bg-stone-200/90',
          'dark:border-stone-700/60 dark:bg-stone-800/80 dark:text-stone-100 dark:hover:bg-stone-700/80'
        )}
        style={{
          animationDelay: `${animationDelay}ms`,
          animationFillMode: 'forwards',
        }}
      >
        <div className="flex items-center space-x-2">
          {isExpanded ? (
            <ChevronUpIcon className="h-3.5 w-3.5 text-stone-600 dark:text-stone-400" />
          ) : (
            <ChevronDownIcon className="h-3.5 w-3.5 text-stone-600 dark:text-stone-400" />
          )}
          <span className="font-serif text-sm font-medium">
            📚 {t('title', { count: retrieverResources.length })}
          </span>
        </div>

        <span
          className={cn(
            'rounded-full px-2 py-0.5 font-serif text-xs',
            'bg-stone-300/80 text-stone-700 dark:bg-stone-600/80 dark:text-stone-100'
          )}
        >
          {retrieverResources[0]?.dataset_name || t('knowledgeBase')}
        </span>
      </button>

      {/* Reference list */}
      {isExpanded && (
        <div
          className={cn(
            'mt-2 overflow-hidden rounded-lg border',
            'animate-fade-in',
            'border-stone-300/60 bg-stone-100/60 backdrop-blur-sm',
            'dark:border-stone-700/50 dark:bg-stone-800/50'
          )}
        >
          <div className="divide-y divide-stone-200/30 dark:divide-stone-700/30">
            {retrieverResources.map((resource, index) => (
              <SourceListItem
                key={`${resource.dataset_id}-${resource.segment_id}-${index}`}
                title={resource.document_name}
                titleAs="h4"
                titleClassName={cn(
                  'truncate font-serif text-sm font-semibold',
                  'text-stone-900 dark:text-stone-100'
                )}
                excerpt={
                  expandedIndex === index
                    ? resource.content
                    : getContentPreview(resource.content)
                }
                excerptClassName={
                  expandedIndex === index ? 'whitespace-pre-wrap' : undefined
                }
                onCopy={() => void handleCopy(resource.content, index)}
                copyLabel={copiedIndex === index ? t('copied') : t('copy')}
                copyIcon={<ClipboardDocumentIcon className="h-3 w-3" />}
                copyClassName={cn(
                  'flex items-center space-x-1 rounded px-2 py-1 font-serif text-xs font-medium transition-colors',
                  'text-stone-500 hover:bg-stone-100 hover:text-stone-700',
                  'dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-200'
                )}
                className={cn(
                  'p-4 transition-all duration-200',
                  'hover:bg-stone-200/70 dark:hover:bg-stone-800/60'
                )}
                renderHeader={title => (
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex min-w-0 flex-1 items-center space-x-3">
                      {/* Index circle */}
                      <div
                        className={cn(
                          'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium',
                          'bg-stone-300 text-stone-700 dark:bg-stone-600 dark:text-stone-200'
                        )}
                      >
                        {index + 1}
                      </div>

                      {/* Document title */}
                      <div className="min-w-0 flex-1">
                        {title}
                        <div className="mt-0.5 flex items-center space-x-2">
                          <span
                            className={cn(
                              'rounded px-1.5 py-0.5 font-serif text-xs',
                              'bg-stone-300/70 text-stone-600 dark:bg-stone-600/50 dark:text-stone-300'
                            )}
                          >
                            {resource.dataset_name}
                          </span>
                          {resource.word_count && (
                            <span
                              className={cn(
                                'font-serif text-xs',
                                'text-stone-600 dark:text-stone-400'
                              )}
                            >
                              {t('wordCount', {
                                count: resource.word_count.toLocaleString(),
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Relevance score */}
                    <div
                      className={cn(
                        'flex-shrink-0 rounded-full px-2 py-1 font-serif text-xs font-bold',
                        'bg-stone-300 text-stone-700 dark:bg-stone-600 dark:text-stone-200'
                      )}
                    >
                      {formatScore(resource.score)}
                    </div>
                  </div>
                )}
                renderExcerpt={excerpt => (
                  <div
                    className={cn(
                      'mb-3 rounded-lg p-3',
                      'border border-stone-300/60 bg-white/80',
                      'dark:border-stone-700/30 dark:bg-stone-900/50'
                    )}
                  >
                    <div
                      className={cn(
                        'font-serif text-sm leading-relaxed',
                        'text-stone-700 dark:text-stone-300'
                      )}
                    >
                      {expandedIndex === index ? (
                        <div className="max-h-40 scrollbar-thin scrollbar-thumb-stone-400 scrollbar-track-transparent overflow-y-auto">
                          {excerpt}
                        </div>
                      ) : (
                        excerpt
                      )}
                    </div>
                  </div>
                )}
                renderActions={copyButton => (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      {/* Expand/Collapse button */}
                      {resource.content.length > 100 && (
                        <button
                          onClick={() => toggleItemExpanded(index)}
                          className={cn(
                            'inline-flex items-center space-x-1 rounded px-2 py-1 font-serif text-xs font-medium',
                            'transition-colors duration-150 focus:outline-none',
                            'text-stone-600 hover:bg-stone-200/50 hover:text-stone-800',
                            'dark:text-stone-400 dark:hover:bg-stone-700/50 dark:hover:text-stone-200'
                          )}
                        >
                          <DocumentTextIcon className="h-3 w-3" />
                          <span>
                            {expandedIndex === index
                              ? t('collapse')
                              : t('expand')}
                          </span>
                        </button>
                      )}

                      {/* Copy button */}
                      {copyButton}
                    </div>

                    {/* Page info (if available) */}
                    {resource.page && (
                      <span
                        className={cn(
                          'font-serif text-xs',
                          'text-stone-400 dark:text-stone-500'
                        )}
                      >
                        {t('page', { page: resource.page })}
                      </span>
                    )}
                  </div>
                )}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
