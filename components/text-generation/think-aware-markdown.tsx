'use client';

import { ThinkBlockContent } from '@components/chat/markdown-block/think-block-content';
import {
  ThinkBlockHeader,
  type ThinkBlockStatus,
} from '@components/chat/markdown-block/think-block-header';
import { extractMainContentForPreview } from '@lib/utils';
import { cn } from '@lib/utils';
import { type MessageBlock, parseThinkBlocks } from '@lib/utils/think-parser';
import { buildThinkPreviewText } from '@lib/utils/think-preview';
import 'katex/dist/katex.min.css';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import React, { useMemo, useState } from 'react';

interface ThinkAwareMarkdownProps {
  content: string;
  markdownComponents: Components;
  isStreaming?: boolean;
  className?: string;
}

function getThinkBlockStatus(
  block: MessageBlock,
  isStreaming: boolean,
  isLast: boolean
): ThinkBlockStatus {
  if (block.status === 'closed') {
    return 'completed';
  }

  if (isStreaming && isLast) {
    return 'thinking';
  }

  return 'completed';
}

function preprocessMainContent(content: string): string {
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
}

function ThinkBlockItem({
  block,
  isStreaming,
  isLast,
}: {
  block: MessageBlock;
  isStreaming: boolean;
  isLast: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const currentStatus = getThinkBlockStatus(block, isStreaming, isLast);
  const previewText = buildThinkPreviewText(block.content);

  return (
    <div className="mb-4 last:mb-0">
      <ThinkBlockHeader
        status={currentStatus}
        isOpen={isOpen}
        previewText={previewText}
        onToggle={() => setIsOpen(prev => !prev)}
      />
      <ThinkBlockContent markdownContent={block.content} isOpen={isOpen} />
    </div>
  );
}

export function extractMainTextFromThinkAwareContent(content: string): string {
  const extracted = extractMainContentForPreview(content);
  if (extracted) {
    return extracted;
  }

  return parseThinkBlocks(content)
    .filter(block => block.type === 'text')
    .map(block => block.content)
    .join('')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}

export function ThinkAwareMarkdown({
  content,
  markdownComponents,
  isStreaming = false,
  className,
}: ThinkAwareMarkdownProps) {
  const blocks = useMemo(() => parseThinkBlocks(content), [content]);

  return (
    <div className={cn('space-y-4', className)}>
      {blocks.map((block, index) => {
        const isLast = index === blocks.length - 1;

        if (block.type === 'think') {
          return (
            <ThinkBlockItem
              key={`think-${index}`}
              block={block}
              isStreaming={isStreaming}
              isLast={isLast}
            />
          );
        }

        const processedContent = preprocessMainContent(block.content);
        return (
          <ReactMarkdown
            key={`text-${index}`}
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={markdownComponents}
          >
            {processedContent}
          </ReactMarkdown>
        );
      })}
    </div>
  );
}
