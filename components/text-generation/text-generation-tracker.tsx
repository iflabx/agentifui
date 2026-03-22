'use client';

import {
  CodeBlock,
  InlineCode,
  MarkdownBlockquote,
  MarkdownTableContainer,
} from '@components/chat/markdown-block';
import { TooltipWrapper } from '@components/ui/tooltip-wrapper';
import { UnifiedStatusPanel } from '@components/workflow/workflow-tracker/unified-status-panel';
import type { AppExecution } from '@lib/types/database';
import { cn } from '@lib/utils';
import 'katex/dist/katex.min.css';
import { Check, Copy, Download, FileText, Loader2 } from 'lucide-react';
import type { Components } from 'react-markdown';

import React, { useEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  ThinkAwareMarkdown,
  extractMainTextFromThinkAwareContent,
} from './think-aware-markdown';

interface TextGenerationTrackerProps {
  isExecuting: boolean;
  isStreaming: boolean;
  generatedText: string;
  currentExecution: AppExecution | null;
  onStop?: () => void;
  onRetry?: () => void;
  onReset?: () => void;
}

/**
 * Text generation tracker component
 *
 * Features:
 * - Real-time display of text generation status
 * - Streaming text display
 * - Unified status panel
 * - Text operation features (copy, download)
 * - Layout structure consistent with WorkflowTracker
 */
export function TextGenerationTracker({
  isExecuting,
  isStreaming,
  generatedText,
  currentExecution,
  onStop,
  onRetry,
  onReset,
}: TextGenerationTrackerProps) {
  const markdownContainerRef = useRef<HTMLDivElement>(null);
  const [isCopied, setIsCopied] = useState(false);
  const t = useTranslations('pages.textGeneration');
  const copyableText = extractMainTextFromThinkAwareContent(generatedText);

  // --- Auto scroll to the bottom ---
  useEffect(() => {
    if (markdownContainerRef.current && isStreaming) {
      markdownContainerRef.current.scrollTop =
        markdownContainerRef.current.scrollHeight;
    }
  }, [generatedText, isStreaming]);

  // --- Reuse the Markdown component configuration of the assistant message ---
  const markdownComponents: Components = {
    code({ className, children }) {
      const match = /language-(\w+)/.exec(className || '');
      const language = match ? match[1] : '';

      if (language) {
        return (
          <CodeBlock language={language} className={className}>
            {String(children).replace(/\n$/, '')}
          </CodeBlock>
        );
      }

      return <InlineCode className={className}>{children}</InlineCode>;
    },
    table({ children }) {
      return <MarkdownTableContainer>{children}</MarkdownTableContainer>;
    },
    blockquote({ children }) {
      return <MarkdownBlockquote>{children}</MarkdownBlockquote>;
    },
    p({ children }) {
      return <p className="font-serif">{children}</p>;
    },
    h1({ children }) {
      return <h1 className="font-serif">{children}</h1>;
    },
    h2({ children }) {
      return <h2 className="font-serif">{children}</h2>;
    },
    h3({ children }) {
      return <h3 className="font-serif">{children}</h3>;
    },
    h4({ children }) {
      return <h4 className="font-serif">{children}</h4>;
    },
    ul({ children }) {
      return <ul className="font-serif">{children}</ul>;
    },
    ol({ children }) {
      return <ol className="font-serif">{children}</ol>;
    },
    li({ children }) {
      return <li className="font-serif">{children}</li>;
    },
  };

  // --- Copy text ---
  const handleCopyText = async () => {
    if (copyableText) {
      try {
        await navigator.clipboard.writeText(copyableText);
        setIsCopied(true);

        // Reset state after 2 seconds
        setTimeout(() => {
          setIsCopied(false);
        }, 2000);
      } catch (error) {
        console.error('[Text generation tracker] Copy failed:', error);
      }
    }
  };

  // --- Download text ---
  const handleDownloadText = () => {
    if (copyableText) {
      const blob = new Blob([copyableText], {
        type: 'text/plain;charset=utf-8',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `generated-text-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* --- Unified status panel --- */}
      {(onStop || onRetry || onReset) && (
        <UnifiedStatusPanel
          isExecuting={isExecuting}
          progress={0} // Text generation does not show specific progress
          error={null} // Error handled by outer layer
          canRetry={false} // Retry handled by outer layer
          currentExecution={currentExecution}
          onStop={onStop || (() => {})}
          onRetry={onRetry || (() => {})}
          onReset={onReset || (() => {})}
          onShowResult={() => {}} // Text generation does not need a separate result viewer
          showResultButton={false} // Text generation does not show the result viewer button
        />
      )}

      {/* --- Text generation area --- */}
      <div className="flex-1 overflow-hidden px-6 py-4">
        {!isExecuting && !currentExecution && !generatedText ? (
          // Empty state
          <div className="flex h-full items-center justify-center">
            <div className="space-y-4 text-center">
              <div
                className={cn(
                  'mx-auto flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed',
                  'border-stone-300 dark:border-stone-600'
                )}
              >
                <FileText
                  className={cn(
                    'h-6 w-6',
                    'text-stone-500 dark:text-stone-400'
                  )}
                />
              </div>
              <div className="space-y-2">
                <h3
                  className={cn(
                    'font-serif text-lg font-semibold',
                    'text-stone-800 dark:text-stone-200'
                  )}
                >
                  {t('emptyState.title')}
                </h3>
                <p
                  className={cn(
                    'font-serif text-sm',
                    'text-stone-600 dark:text-stone-400'
                  )}
                >
                  {t('emptyState.description')}
                </p>
              </div>
            </div>
          </div>
        ) : (
          // Text generation content
          <div className="flex h-full flex-col space-y-4">
            {/* Status title */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3
                  className={cn(
                    'font-serif text-lg font-semibold',
                    'text-stone-800 dark:text-stone-200'
                  )}
                >
                  {isExecuting || isStreaming
                    ? t('status.generating')
                    : t('status.result')}
                </h3>
              </div>

              {/* Operation buttons */}
              {generatedText && !isExecuting && (
                <div className="flex items-center gap-2">
                  {/* Copy button */}
                  <TooltipWrapper
                    content={isCopied ? t('buttons.copied') : t('buttons.copy')}
                    id="text-generation-copy-btn"
                    placement="bottom"
                    size="sm"
                    showArrow={false}
                    _desktopOnly={true}
                  >
                    <button
                      onClick={handleCopyText}
                      className={cn(
                        'flex items-center justify-center rounded-lg p-2 transition-colors',
                        'text-stone-500 hover:bg-stone-300/40 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-600/40 dark:hover:text-stone-300',
                        'focus:outline-none'
                      )}
                      style={{ transform: 'translateZ(0)' }}
                      aria-label={
                        isCopied ? t('buttons.copied') : t('buttons.copy')
                      }
                    >
                      {isCopied ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </button>
                  </TooltipWrapper>

                  {/* Download button */}
                  <TooltipWrapper
                    content={t('buttons.download')}
                    id="text-generation-download-btn"
                    placement="bottom"
                    size="sm"
                    showArrow={false}
                    _desktopOnly={true}
                  >
                    <button
                      onClick={handleDownloadText}
                      className={cn(
                        'flex items-center justify-center rounded-lg p-2 transition-colors',
                        'text-stone-500 hover:bg-stone-300/40 hover:text-stone-700 dark:text-stone-400 dark:hover:bg-stone-600/40 dark:hover:text-stone-300',
                        'focus:outline-none'
                      )}
                      style={{ transform: 'translateZ(0)' }}
                      aria-label={t('buttons.download')}
                    >
                      <Download className="h-4 w-4" />
                    </button>
                  </TooltipWrapper>
                </div>
              )}
            </div>

            {/* Text display area */}
            <div className="relative flex-1 overflow-hidden">
              {isExecuting && !generatedText ? (
                // Loading state
                <div
                  className={cn(
                    'absolute inset-0 flex items-center justify-center rounded-lg border-2 border-dashed',
                    'border-stone-300 bg-stone-50 dark:border-stone-600 dark:bg-stone-800/50'
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Loader2
                      className={cn(
                        'h-5 w-5 animate-spin',
                        'text-stone-600 dark:text-stone-400'
                      )}
                    />
                    <div>
                      <div
                        className={cn(
                          'font-serif font-medium',
                          'text-stone-800 dark:text-stone-200'
                        )}
                      >
                        {t('loadingState.title')}
                      </div>
                      <div
                        className={cn(
                          'font-serif text-sm',
                          'text-stone-600 dark:text-stone-400'
                        )}
                      >
                        {t('loadingState.description')}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                // Markdown rendered content
                <div
                  ref={markdownContainerRef}
                  className={cn(
                    'absolute inset-0 overflow-y-auto overscroll-contain rounded-lg border p-4 font-serif',
                    'focus:border-transparent focus:ring-2 focus:ring-stone-500 focus:outline-none',
                    'assistant-message-content', // Reuse the style class of the assistant message
                    'border-stone-300 bg-white text-stone-900 dark:border-stone-600 dark:bg-stone-800 dark:text-stone-200'
                  )}
                  style={{
                    scrollBehavior: 'auto',
                  }}
                >
                  {generatedText ? (
                    <ThinkAwareMarkdown
                      content={generatedText}
                      markdownComponents={markdownComponents}
                      isStreaming={isStreaming}
                    />
                  ) : (
                    <div
                      className={cn(
                        'flex h-full items-center justify-center font-serif',
                        'text-stone-500 dark:text-stone-400'
                      )}
                    >
                      {isExecuting
                        ? t('placeholder.generating')
                        : t('placeholder.result')}
                    </div>
                  )}
                </div>
              )}

              {/* Streaming generation indicator */}
              {isStreaming && (
                <div
                  className={cn(
                    'absolute right-4 bottom-4 flex items-center gap-2 rounded-full px-3 py-1 text-xs',
                    'bg-stone-100 text-stone-600 dark:bg-stone-700 dark:text-stone-300'
                  )}
                >
                  <div className="h-2 w-2 animate-pulse rounded-full bg-green-500" />
                  <span className="font-serif">{t('streamingIndicator')}</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
