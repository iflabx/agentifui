'use client';

import {
  CodeBlock,
  InlineCode,
  MarkdownBlockquote,
  MarkdownTableContainer,
} from '@components/chat/markdown-block';
// Keep existing think block components
import { ThinkBlockContent } from '@components/chat/markdown-block/think-block-content';
/**
 * Atomic Markdown components and Think Block related components
 *
 * Text style system documentation:
 * This component uses a specialized CSS class system to control assistant message text display:
 *
 * 1. Line height control hierarchy:
 *    - Base line height: 1.35 (compact, for lists etc.)
 *    - Paragraph line height: 1.9 (loose, improves readability)
 *    - Heading line height: 1.25 (tightest, emphasizes hierarchy)
 *
 * 2. Paragraph spacing control:
 *    - Current setting: 0.1em (very small separation spacing)
 *    - Can be adjusted in styles/markdown.css at .assistant-message-content p
 *
 * 3. Style file locations:
 *    - Main styles: styles/markdown.css (lines 277-340)
 *    - Style class name: .assistant-message-content
 *
 * To adjust text density or spacing, modify the corresponding CSS files rather than this component.
 */
import {
  ThinkBlockHeader,
  ThinkBlockStatus,
} from '@components/chat/markdown-block/think-block-header';
import { AssistantMessageActions } from '@components/chat/message-actions';
import { ReferenceSources } from '@components/chat/reference-sources';
import { cn } from '@lib/utils';
import { MessageBlock, parseThinkBlocks } from '@lib/utils/think-parser';
import { buildThinkPreviewText } from '@lib/utils/think-preview';
import 'katex/dist/katex.min.css';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import React, { useMemo, useState } from 'react';

import { useTranslations } from 'next-intl';

import { StreamingText } from './streaming-markdown';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Extract main content for copy (concatenates text blocks)
const extractMainContentForCopy = (blocks: MessageBlock[]): string => {
  // Only include text blocks and keep their original spacing intact.
  const textContent = blocks
    .filter(block => block.type === 'text')
    .map(block => block.content)
    .join('');

  // Remove extra blank lines
  return textContent.replace(/\n\s*\n/g, '\n').trim();
};

// Individual Think Block Component
interface ThinkBlockItemProps {
  block: MessageBlock;
  isStreaming: boolean;
  isLast: boolean;
  wasManuallyStopped: boolean;
}

const ThinkBlockItem = ({
  block,
  isStreaming,
  isLast,
  wasManuallyStopped,
}: ThinkBlockItemProps) => {
  const [isOpen, setIsOpen] = useState(false);

  // Calculate the current think block status
  const calculateStatus = (): ThinkBlockStatus => {
    if (block.status === 'closed') {
      return 'completed';
    }
    if (wasManuallyStopped) {
      return 'stopped';
    }
    // Parser leaves unfinished <think> tags "open"; only the last streaming block counts as thinking.
    if (isStreaming && isLast) {
      return 'thinking';
    }

    return 'completed';
  };

  const currentStatus = calculateStatus();
  const previewText = buildThinkPreviewText(block.content);

  // Determine if this specific block is currently streaming (animating)
  // It animates if it is the last block and the global stream is active.
  // OR if it is 'open' and we are streaming.
  const isBlockStreaming = isStreaming && isLast && block.status === 'open';
  const isBlockComplete = !isStreaming || !isLast || block.status === 'closed';

  return (
    <div className="mb-4 last:mb-0">
      <ThinkBlockHeader
        status={currentStatus}
        isOpen={isOpen}
        previewText={previewText}
        onToggle={() => setIsOpen(prev => !prev)}
      />
      <StreamingText
        content={block.content}
        isStreaming={isBlockStreaming}
        isComplete={isBlockComplete}
        typewriterSpeed={80}
      >
        {displayedThinkContent => (
          <ThinkBlockContent
            markdownContent={displayedThinkContent}
            isOpen={isOpen}
          />
        )}
      </StreamingText>
    </div>
  );
};

interface AssistantMessageProps {
  id: string;
  content: string;
  isStreaming: boolean;
  wasManuallyStopped: boolean;
  metadata?: Record<string, any>; // Message metadata
  className?: string;
}

/**
 * Assistant Message Component
 * Renders assistant messages with streaming, think blocks, markdown, references, and actions.
 *
 * Features:
 * - Streaming text with typewriter effect
 * - Think block extraction and rendering
 * - Markdown content rendering
 * - Reference sources display
 * - Message actions (copy, regenerate, feedback)
 *
 * Uses React.memo for performance optimization.
 */
export const AssistantMessage: React.FC<AssistantMessageProps> = React.memo(
  ({ id, content, isStreaming, wasManuallyStopped, metadata, className }) => {
    const t = useTranslations('pages.chat');

    // Parse content into blocks
    const blocks = useMemo(() => parseThinkBlocks(content), [content]);

    // Preprocess main content: escape unknown HTML tags
    const preprocessMainContent = (content: string): string => {
      // Whitelist of allowed HTML tags
      const knownHtmlTags = new Set([
        'div',
        'span',
        'p',
        'br',
        'hr',
        'strong',
        'em',
        'b',
        'i',
        'u',
        's',
        'h1',
        'h2',
        'h3',
        'h4',
        'h5',
        'h6',
        'ul',
        'ol',
        'li',
        'dl',
        'dt',
        'dd',
        'table',
        'thead',
        'tbody',
        'tr',
        'th',
        'td',
        'blockquote',
        'pre',
        'code',
        'a',
        'img',
        'sub',
        'sup',
        'mark',
        'del',
        'ins',
        'details',
        'summary',
      ]);

      // Escape HTML tags not in whitelist
      return content
        .replace(/<([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (match, tagName) => {
          if (!knownHtmlTags.has(tagName.toLowerCase())) {
            return match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          }
          return match;
        })
        .replace(/<\/([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g, (match, tagName) => {
          if (!knownHtmlTags.has(tagName.toLowerCase())) {
            return match.replace(/</g, '&lt;').replace(/>/g, '&gt;');
          }
          return match;
        });
    };

    // Markdown rendering components for main content
    const mainMarkdownComponents: Components = {
      // Render code blocks and inline code
      code({ node, className, children, ...props }: any) {
        const match = /language-(\w+)/.exec(className || '');
        const language = match ? match[1] : null;

        if (node.position?.start.line !== node.position?.end.line || language) {
          // Multi-line code or specified language: code block
          return (
            <CodeBlock
              language={language}
              className={className}
              isStreaming={isStreaming}
              {...props}
            >
              {String(children).replace(/\n$/, '')}
            </CodeBlock>
          );
        }
        // Single line code: inline code
        return <InlineCode {...props}>{children}</InlineCode>;
      },

      // Render table container and table cells
      table({ children, ...props }: any) {
        return (
          <MarkdownTableContainer {...props}>{children}</MarkdownTableContainer>
        );
      },
      th({ children, ...props }: any) {
        return (
          <th
            className={cn(
              'border px-4 py-2 text-left font-medium',
              'border-gray-300 bg-gray-100 dark:border-gray-600 dark:bg-gray-700'
            )}
            {...props}
          >
            {children}
          </th>
        );
      },
      td({ children, ...props }: any) {
        return (
          <td
            className={cn(
              'border px-4 py-2',
              'border-gray-300 dark:border-gray-600'
            )}
            {...props}
          >
            {children}
          </td>
        );
      },
      blockquote({ children, ...props }: any) {
        return <MarkdownBlockquote {...props}>{children}</MarkdownBlockquote>;
      },
      p({ children, ...props }) {
        return <p {...props}>{children}</p>;
      },
      ul({ children, ...props }) {
        return (
          <ul className="list-disc space-y-1 pl-6" {...props}>
            {children}
          </ul>
        );
      },
      ol({ children, ...props }) {
        return (
          <ol className="list-decimal space-y-1 pl-6" {...props}>
            {children}
          </ol>
        );
      },
      li({ children, ...props }) {
        return (
          <li className="pl-1" {...props}>
            {children}
          </li>
        );
      },
      h1({ children, ...props }) {
        return (
          <h1
            className={cn(
              'mt-6 mb-4 text-3xl font-bold',
              'text-gray-900 dark:text-gray-100'
            )}
            {...props}
          >
            {children}
          </h1>
        );
      },
      h2({ children, ...props }) {
        return (
          <h2
            className={cn(
              'mt-5 mb-3 text-2xl font-semibold',
              'text-gray-900 dark:text-gray-100'
            )}
            {...props}
          >
            {children}
          </h2>
        );
      },
      h3({ children, ...props }) {
        return (
          <h3
            className={cn(
              'mt-4 mb-2 text-xl font-medium',
              'text-gray-900 dark:text-gray-100'
            )}
            {...props}
          >
            {children}
          </h3>
        );
      },
      h4({ children, ...props }) {
        return (
          <h4
            className={cn(
              'mt-3 mb-2 text-lg font-medium',
              'text-gray-900 dark:text-gray-100'
            )}
            {...props}
          >
            {children}
          </h4>
        );
      },
      a({ children, href, ...props }: any) {
        // Ensure href is a string
        const linkUrl = typeof href === 'string' ? href : '';

        // If the link contains an image, render as image link
        const hasImageChild = React.Children.toArray(children).some(
          child =>
            React.isValidElement(child) &&
            (child.type === 'img' || (child.props as any)?.src)
        );

        if (hasImageChild) {
          // Extract image info from children
          const imageChild = React.Children.toArray(children).find(
            child =>
              React.isValidElement(child) &&
              (child.type === 'img' || (child.props as any)?.src)
          ) as React.ReactElement;

          const imageAlt = (imageChild?.props as any)?.alt || '';

          return (
            <a
              href={linkUrl}
              className={cn(
                'inline-flex items-center gap-1 rounded border px-2 py-1 text-sm',
                'border-gray-300 bg-gray-50 text-sky-600 hover:border-gray-400 hover:text-sky-700',
                'dark:border-gray-600 dark:bg-gray-800 dark:text-sky-400 dark:hover:border-gray-500 dark:hover:text-sky-300'
              )}
              target="_blank"
              rel="noopener noreferrer"
              title={imageAlt || t('messages.viewImage')}
              {...props}
            >
              <svg
                className="h-4 w-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
              {imageAlt}
            </a>
          );
        }

        // Regular link
        return (
          <a
            href={href}
            className={cn(
              'underline',
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
      hr({ ...props }) {
        return (
          <hr
            className={cn(
              'my-4 border-t',
              'border-gray-300 dark:border-gray-700'
            )}
            {...props}
          />
        );
      },
      // Render images as links to avoid loading jitter
      // If image is inside a link, skip rendering here (handled by parent <a>)
      img({ src, alt, node, ...props }: any) {
        // Ensure src is a string
        const imageUrl = typeof src === 'string' ? src : '';

        // If inside a link, skip rendering
        const isInsideLink = node?.parent?.tagName === 'a';

        if (isInsideLink) {
          return null;
        }

        // Render image as a link
        return (
          <a
            href={imageUrl}
            className={cn(
              'inline-flex items-center gap-1 rounded border px-2 py-1 text-sm',
              'border-gray-300 bg-gray-50 text-sky-600 hover:border-gray-400 hover:text-sky-700',
              'dark:border-gray-600 dark:bg-gray-800 dark:text-sky-400 dark:hover:border-gray-500 dark:hover:text-sky-300'
            )}
            target="_blank"
            rel="noopener noreferrer"
            title={alt || t('messages.viewImage')}
            {...props}
          >
            <svg
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            {alt || t('messages.imageLink')}
          </a>
        );
      },
    };

    return (
      <div
        className={cn(
          'assistant-message-container group mb-6 w-full',
          className
        )}
        data-message-id={id}
      >
        {blocks.map((block, index) => {
          const isLast = index === blocks.length - 1;

          if (block.type === 'think') {
            return (
              <ThinkBlockItem
                key={`think-${index}`}
                block={block}
                isStreaming={isStreaming}
                isLast={isLast}
                wasManuallyStopped={wasManuallyStopped}
              />
            );
          }

          return (
            <div
              key={`text-${index}`}
              className={cn(
                'markdown-body main-content-area assistant-message-content w-full text-base',
                'text-stone-800 dark:text-stone-200',
                'mb-4 last:mb-0' // Add spacing between blocks
              )}
            >
              <StreamingText
                content={preprocessMainContent(block.content)}
                isStreaming={isStreaming && isLast}
                isComplete={!isStreaming || !isLast}
                typewriterSpeed={50}
              >
                {displayedContent => (
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkMath]}
                    rehypePlugins={[rehypeKatex, rehypeRaw]}
                    components={mainMarkdownComponents}
                  >
                    {displayedContent}
                  </ReactMarkdown>
                )}
              </StreamingText>
            </div>
          );
        })}

        {/* Reference sources and attribution - Show at the bottom if exists */}
        {(metadata?.dify_retriever_resources ||
          metadata?.dify_metadata?.retriever_resources) && (
          <div className="px-2">
            <ReferenceSources
              retrieverResources={
                metadata?.dify_retriever_resources ||
                metadata?.dify_metadata?.retriever_resources
              }
              className="mt-2 mb-2"
              animationDelay={isStreaming ? 0 : 300}
            />
          </div>
        )}

        {/* Assistant message action buttons - Always show at bottom */}
        <div className="px-2">
          <AssistantMessageActions
            messageId={id}
            content={extractMainContentForCopy(blocks) || undefined}
            onRegenerate={() => console.log('Regenerate message', id)}
            onFeedback={isPositive =>
              console.log('Feedback', isPositive ? 'positive' : 'negative', id)
            }
            isRegenerating={isStreaming}
            className={cn(
              '-ml-2',
              (
                metadata?.dify_retriever_resources ||
                metadata?.dify_metadata?.retriever_resources
              )?.length > 0
                ? 'mt-0'
                : '-mt-4'
            )}
          />
        </div>
      </div>
    );
  }
);

// Set displayName for React DevTools
AssistantMessage.displayName = 'AssistantMessage';
