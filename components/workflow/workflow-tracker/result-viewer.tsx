'use client';

// --- Import workflow Markdown components ---
import {
  CodeBlock,
  InlineCode,
  MarkdownBlockquote,
  MarkdownTableContainer,
} from '@components/chat/markdown-block';
import { ThinkBlockContent } from '@components/chat/markdown-block/think-block-content';
// --- Import ThinkBlock components ---
import { ThinkBlockHeader } from '@components/chat/markdown-block/think-block-header';
import { useMobile } from '@lib/hooks/use-mobile';
import { cn } from '@lib/utils';
import 'katex/dist/katex.min.css';
import { Copy, Download, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import { useCallback, useEffect, useMemo } from 'react';
// --- Import React Hook ---
import React, { useState } from 'react';

import { useTranslations } from 'next-intl';

interface ResultViewerProps {
  result: unknown;
  execution: unknown;
  onClose: () => void;
}

/**
 * Parse the think tag content in the workflow result
 * @param content Original content string
 * @returns Parsed result containing think content and main content
 */
const parseThinkContent = (
  content: string
): {
  hasThinkBlock: boolean;
  thinkContent: string;
  mainContent: string;
  isThinkComplete: boolean;
} => {
  const thinkStartTag = '<think>';
  const thinkEndTag = '</think>';

  // Check if it contains think tags
  if (content.includes(thinkStartTag)) {
    const startIndex = content.indexOf(thinkStartTag);
    const endIndex = content.indexOf(thinkEndTag, startIndex);

    if (endIndex !== -1) {
      // Think block complete
      const thinkContent = content.substring(
        startIndex + thinkStartTag.length,
        endIndex
      );
      const mainContent = content
        .substring(endIndex + thinkEndTag.length)
        .trim();

      return {
        hasThinkBlock: true,
        thinkContent: thinkContent.trim(),
        mainContent,
        isThinkComplete: true,
      };
    } else {
      // Think block incomplete (theoretically should not appear in the result viewer)
      const thinkContent = content.substring(startIndex + thinkStartTag.length);
      return {
        hasThinkBlock: true,
        thinkContent: thinkContent.trim(),
        mainContent: '',
        isThinkComplete: false,
      };
    }
  }

  // No think tags
  return {
    hasThinkBlock: false,
    thinkContent: '',
    mainContent: content,
    isThinkComplete: true,
  };
};

export function ResultViewer({
  result,
  execution,
  onClose,
}: ResultViewerProps) {
  const isMobile = useMobile();
  const t = useTranslations('pages.workflow.resultViewer');

  // --- ThinkBlock status management ---
  const [isThinkOpen, setIsThinkOpen] = useState(false); // Default folded

  const formatResult = (
    data: unknown
  ): {
    content: string;
    isMarkdown: boolean;
    hasThinkBlock: boolean;
    thinkContent: string;
    mainContent: string;
  } => {
    try {
      if (!data || typeof data !== 'object') {
        const content = String(data || '');
        const parsed = parseThinkContent(content);
        return {
          content,
          isMarkdown: false,
          hasThinkBlock: parsed.hasThinkBlock,
          thinkContent: parsed.thinkContent,
          mainContent: parsed.mainContent,
        };
      }

      const dataRecord = data as Record<string, unknown>;

      // Check if there are result1, result2, etc. fields (workflow result mode)
      const resultKeys = Object.keys(dataRecord).filter(key =>
        key.startsWith('result')
      );
      if (resultKeys.length > 0) {
        // Use the first result field first
        const firstResultKey = resultKeys[0];
        const resultContent = dataRecord[firstResultKey];

        if (typeof resultContent === 'string') {
          // 🎯 Key modification: no longer delete think blocks, but parse them
          const parsed = parseThinkContent(resultContent);

          // Check if the main content contains markdown
          const markdownContent = parsed.mainContent || parsed.thinkContent;
          const isMarkdown =
            markdownContent.includes('```') ||
            markdownContent.includes('#') ||
            markdownContent.includes('**');

          return {
            content: resultContent,
            isMarkdown,
            hasThinkBlock: parsed.hasThinkBlock,
            thinkContent: parsed.thinkContent,
            mainContent: parsed.mainContent,
          };
        }
      }

      // If there is a text field, display the text content first
      if (
        typeof dataRecord.text === 'string' &&
        dataRecord.text.trim().length > 0
      ) {
        const parsed = parseThinkContent(dataRecord.text);
        const isMarkdown = dataRecord.text.includes('```');

        return {
          content: dataRecord.text,
          isMarkdown,
          hasThinkBlock: parsed.hasThinkBlock,
          thinkContent: parsed.thinkContent,
          mainContent: parsed.mainContent,
        };
      }

      // If there is an outputs field, display the outputs content first
      if (dataRecord.outputs && typeof dataRecord.outputs === 'object') {
        const content = JSON.stringify(dataRecord.outputs, null, 2);
        return {
          content,
          isMarkdown: false,
          hasThinkBlock: false,
          thinkContent: '',
          mainContent: content,
        };
      }

      // Otherwise, display the complete data
      const content = JSON.stringify(dataRecord, null, 2);
      return {
        content,
        isMarkdown: false,
        hasThinkBlock: false,
        thinkContent: '',
        mainContent: content,
      };
    } catch (error) {
      console.error('[Result viewer] Data formatting failed:', error);
      const content = String(data);
      const parsed = parseThinkContent(content);
      return {
        content,
        isMarkdown: false,
        hasThinkBlock: parsed.hasThinkBlock,
        thinkContent: parsed.thinkContent,
        mainContent: parsed.mainContent,
      };
    }
  };

  const {
    content: formattedContent,
    isMarkdown,
    hasThinkBlock,
    thinkContent,
    mainContent,
  } = formatResult(result);

  // --- Markdown component configuration ---
  const markdownComponents: Components = {
    code({ className, children }) {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : null;

      if (language) {
        // Code block
        return (
          <CodeBlock
            language={language}
            className={className}
            isStreaming={false}
          >
            {String(children).replace(/\n$/, '')}
          </CodeBlock>
        );
      } else {
        // Inline code
        return <InlineCode className={className}>{children}</InlineCode>;
      }
    },
    table({ children }) {
      return <MarkdownTableContainer>{children}</MarkdownTableContainer>;
    },
    blockquote({ children }) {
      return <MarkdownBlockquote>{children}</MarkdownBlockquote>;
    },
    p({ children }) {
      return <p className="my-2 font-serif">{children}</p>;
    },
    ul({ children }) {
      return (
        <ul className="my-2.5 ml-6 list-disc space-y-1 font-serif">
          {children}
        </ul>
      );
    },
    ol({ children }) {
      return (
        <ol className="my-2.5 ml-6 list-decimal space-y-1 font-serif">
          {children}
        </ol>
      );
    },
    li({ children }) {
      return <li className="pb-0.5">{children}</li>;
    },
    h1({ children }) {
      return (
        <h1
          className={cn(
            'mt-4 mb-2 border-b pb-1 font-serif text-2xl font-semibold',
            'border-gray-300 dark:border-gray-700'
          )}
        >
          {children}
        </h1>
      );
    },
    h2({ children }) {
      return (
        <h2
          className={cn(
            'mt-3.5 mb-1.5 border-b pb-1 font-serif text-xl font-semibold',
            'border-gray-300 dark:border-gray-700'
          )}
        >
          {children}
        </h2>
      );
    },
    h3({ children }) {
      return (
        <h3 className="mt-3 mb-1 font-serif text-lg font-semibold">
          {children}
        </h3>
      );
    },
    h4({ children }) {
      return (
        <h4 className="mt-2.5 mb-0.5 font-serif text-base font-semibold">
          {children}
        </h4>
      );
    },
    a({ children, href, ...props }) {
      return (
        <a
          href={href}
          className={cn(
            'font-serif underline',
            'text-sky-600 hover:text-sky-700 dark:text-sky-400 dark:hover:text-sky-300'
          )}
          target="_blank"
          rel="noopener noreferrer"
          {...props}
        >
          {children}
        </a>
      );
    },
    hr() {
      return (
        <hr
          className={cn(
            'my-4 border-t',
            'border-gray-300 dark:border-gray-700'
          )}
        />
      );
    },
  };

  const handleCopy = async () => {
    try {
      // When copying, only copy the main content, not the think block
      const copyContent = hasThinkBlock ? mainContent : formattedContent;
      await navigator.clipboard.writeText(copyContent);
      // Here you can add a success prompt
    } catch (error) {
      console.error('Copy failed:', error);
    }
  };

  const handleDownload = () => {
    const element = document.createElement('a');
    const copyContent = hasThinkBlock ? mainContent : formattedContent;
    const file = new Blob([copyContent], { type: 'text/plain' });
    element.href = URL.createObjectURL(file);

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const extension = isMarkdown ? 'md' : 'json';
    element.download = `workflow-result-${timestamp}.${extension}`;

    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div
        className={cn(
          'relative mx-4 flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-lg border shadow-2xl',
          'border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900'
        )}
      >
        {/* Header area */}
        <div
          className={cn(
            'flex items-center justify-between border-b px-6 py-4',
            'border-gray-200 dark:border-gray-700'
          )}
        >
          <h2
            className={cn(
              'text-lg font-semibold',
              'text-gray-900 dark:text-white'
            )}
          >
            {t('title')}
          </h2>
          <div className="flex items-center space-x-2">
            <button
              onClick={handleCopy}
              className={cn(
                'rounded-md p-2 transition-colors',
                'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
              )}
              title={t('copyButton')}
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              onClick={handleDownload}
              className={cn(
                'rounded-md p-2 transition-colors',
                'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
              )}
              title={t('downloadButton')}
            >
              <Download className="h-4 w-4" />
            </button>
            <button
              onClick={onClose}
              className={cn(
                'rounded-md p-2 transition-colors',
                'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-white'
              )}
              title={t('closeButton')}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content area */}
        <div
          className={cn(
            'flex-1 overflow-y-auto p-6',
            'bg-white dark:bg-gray-900'
          )}
        >
          {/* 🎯 Think Block area */}
          {hasThinkBlock && thinkContent && (
            <div className="mb-4">
              <ThinkBlockHeader
                status="completed"
                isOpen={isThinkOpen}
                onToggle={() => setIsThinkOpen(!isThinkOpen)}
              />
              {isThinkOpen && (
                <ThinkBlockContent
                  markdownContent={thinkContent}
                  isOpen={isThinkOpen}
                />
              )}
            </div>
          )}

          {/* Main content area */}
          {(mainContent || (!hasThinkBlock && formattedContent)) && (
            <div
              className={cn(
                'markdown-body w-full',
                'text-gray-900 dark:text-gray-100'
              )}
            >
              {isMarkdown ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath]}
                  rehypePlugins={[rehypeKatex]}
                  components={markdownComponents}
                >
                  {hasThinkBlock ? mainContent : formattedContent}
                </ReactMarkdown>
              ) : (
                <pre
                  className={cn(
                    'font-mono text-sm break-words whitespace-pre-wrap',
                    'text-gray-700 dark:text-gray-300'
                  )}
                >
                  {hasThinkBlock ? mainContent : formattedContent}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
