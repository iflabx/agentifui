'use client';

import { cn } from '@lib/utils';
import { CodeIcon, DownloadIcon, EyeIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import React, { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

interface MarkdownPreviewProps {
  content: Blob;
  filename: string;
  onDownload: () => void;
}

export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  filename,
  onDownload,
}) => {
  const t = useTranslations('filePreview.markdownPreview');
  const [markdown, setMarkdown] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'rendered' | 'raw'>('rendered');

  useEffect(() => {
    const loadMarkdown = async () => {
      try {
        const textContent = await content.text();
        setMarkdown(textContent);
      } catch {
        setMarkdown('Error loading content');
      } finally {
        setIsLoading(false);
      }
    };

    loadMarkdown();
  }, [content]);

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className={cn('h-4 rounded', 'bg-stone-200 dark:bg-stone-700')} />
        <div
          className={cn('h-4 w-3/4 rounded', 'bg-stone-200 dark:bg-stone-700')}
        />
        <div
          className={cn('h-4 w-1/2 rounded', 'bg-stone-200 dark:bg-stone-700')}
        />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col space-y-4">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">{t('title')}</h3>
        <div className="flex space-x-2">
          <div
            className={cn(
              'inline-flex rounded-md',
              'bg-stone-100 dark:bg-stone-800'
            )}
          >
            <button
              onClick={() => setViewMode('rendered')}
              className={cn(
                'inline-flex items-center space-x-1 rounded-l-md px-2 py-1 text-xs font-medium transition-colors',
                viewMode === 'rendered'
                  ? 'bg-stone-300 text-stone-800 dark:bg-stone-600 dark:text-stone-200'
                  : 'text-stone-600 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300'
              )}
            >
              <EyeIcon className="h-3 w-3" />
              <span>{t('renderedMode')}</span>
            </button>
            <button
              onClick={() => setViewMode('raw')}
              className={cn(
                'inline-flex items-center space-x-1 rounded-r-md px-2 py-1 text-xs font-medium transition-colors',
                viewMode === 'raw'
                  ? 'bg-stone-300 text-stone-800 dark:bg-stone-600 dark:text-stone-200'
                  : 'text-stone-600 hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-300'
              )}
            >
              <CodeIcon className="h-3 w-3" />
              <span>{t('rawMode')}</span>
            </button>
          </div>
          <button
            onClick={onDownload}
            className={cn(
              'inline-flex items-center space-x-1 rounded px-2 py-1 text-xs font-medium transition-colors',
              'bg-stone-200 text-stone-800 hover:bg-stone-300',
              'dark:bg-stone-700 dark:text-stone-200 dark:hover:bg-stone-600'
            )}
            title={t('downloadButton')}
          >
            <DownloadIcon className="h-3 w-3" />
            <span>{t('downloadButton')}</span>
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className={cn(
          'min-h-[60vh] flex-1 overflow-auto rounded-md border p-4',
          'border-stone-200 bg-stone-50',
          'dark:border-stone-700 dark:bg-stone-800'
        )}
      >
        {viewMode === 'rendered' ? (
          <div className={cn('prose prose-sm max-w-none', 'dark:prose-invert')}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const isBlock = className?.includes('language-');

                  if (isBlock) {
                    return (
                      <code
                        className={cn('font-mono text-sm', className)}
                        {...props}
                      >
                        {children}
                      </code>
                    );
                  }

                  return (
                    <code
                      className={cn(
                        'rounded px-1 py-0.5 font-mono text-sm',
                        'bg-stone-200 dark:bg-stone-700'
                      )}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                },
                pre({ children, ...props }) {
                  return (
                    <pre
                      className={cn(
                        'overflow-x-auto rounded-md p-3 font-mono text-sm',
                        'bg-stone-200 dark:bg-stone-700'
                      )}
                      {...props}
                    >
                      {children}
                    </pre>
                  );
                },
              }}
            >
              {markdown}
            </ReactMarkdown>
          </div>
        ) : (
          <pre
            className={cn(
              'font-mono text-sm break-words whitespace-pre-wrap',
              'text-stone-800 dark:text-stone-200'
            )}
          >
            {markdown}
          </pre>
        )}
      </div>

      {/* File info */}
      <div
        className={cn(
          'flex-shrink-0 text-xs',
          'text-stone-500 dark:text-stone-400'
        )}
      >
        {filename} • Markdown Document •{' '}
        {t('charactersCount', { count: markdown.length.toLocaleString() })}
      </div>
    </div>
  );
};
