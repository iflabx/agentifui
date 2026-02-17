'use client';

import { cn } from '@lib/utils';
// Remove useTheme and useThemeColors imports, use CSS variables instead
import { motion } from 'framer-motion';
import 'katex/dist/katex.min.css';
import ReactMarkdown from 'react-markdown';
import type { Components } from 'react-markdown';
import rehypeKatex from 'rehype-katex';
import rehypeRaw from 'rehype-raw';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

import React from 'react';

import { useTranslations } from 'next-intl';

// Only import motion

/**
 * Props for the ThinkBlockContent container
 */
interface ThinkBlockContentProps {
  // Markdown content to display
  markdownContent: string;
  // Controls whether the content is shown
  isOpen: boolean; // Still needed for animation state switching
}

/**
 * ThinkBlock content display container
 * Uses ReactMarkdown to render content
 * Provides smooth animation for open/close transitions
 */
export const ThinkBlockContent: React.FC<ThinkBlockContentProps> = ({
  markdownContent,
  isOpen,
}) => {
  // Remove useTheme and useThemeColors, use CSS variables instead
  const t = useTranslations('pages.chat.messages');

  // Preprocess content: escape custom HTML tags to avoid browser parsing errors
  // Similar to code block handling, display unknown tags as text
  const preprocessContent = (content: string): string => {
    // Define a whitelist of known safe HTML tags
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
    ]);

    // Escape HTML tags not in the whitelist so they display as text
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

  const processedContent = preprocessContent(markdownContent);

  const isImageTag = (value: unknown): value is { tagName: string } => {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const record = value as Record<string, unknown>;
    return record.tagName === 'img';
  };

  const getNodeAlt = (value: unknown): string | undefined => {
    if (!value || typeof value !== 'object') {
      return undefined;
    }

    const record = value as Record<string, unknown>;
    const properties = record.properties;
    if (!properties || typeof properties !== 'object') {
      return undefined;
    }

    const alt = (properties as Record<string, unknown>).alt;
    return typeof alt === 'string' ? alt : undefined;
  };

  const hasAnchorParent = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const parent = (value as { parent?: unknown }).parent;
    if (!parent || typeof parent !== 'object') {
      return false;
    }

    return (parent as { tagName?: unknown }).tagName === 'a';
  };

  // --- Markdown renderer component configuration ---
  const markdownComponents: Components = {
    code({ className, children, ...props }) {
      // If not a code block with language (inline code)
      return !className?.includes('language-') ? (
        <code
          className="rounded px-2 py-1 font-mono"
          style={{
            backgroundColor: 'var(--md-think-inline-code-bg)',
            color: 'var(--md-think-inline-code-text)',
          }}
          {...props}
        >
          {children}
        </code>
      ) : (
        // If it is a code block with language
        <pre
          className="my-4 overflow-auto rounded-md border p-5"
          style={{
            backgroundColor: 'var(--md-code-bg)',
            color: 'var(--md-code-text)',
            borderColor: 'var(--md-code-border)',
          }}
        >
          <code
            className={cn(className, 'block text-base whitespace-pre-wrap')}
            {...props}
          >
            {children}
          </code>
        </pre>
      );
    },

    // Table rendering
    table({ children, ...props }) {
      return (
        <div
          className="my-5 w-full overflow-x-auto rounded-md border"
          style={{
            borderColor: 'var(--md-table-border)',
          }}
        >
          <table
            className="min-w-full divide-y"
            style={{
              borderColor: 'var(--md-table-border)',
              // CSS does not have divideColor property, use class for divider color
            }}
            {...props}
          >
            {children}
          </table>
        </div>
      );
    },

    // Table header cell style
    th({ children, ...props }) {
      return (
        <th
          className="px-5 py-3 text-left text-base font-medium"
          style={{
            backgroundColor: 'var(--md-table-header-bg)',
            color: 'var(--md-table-header-text)',
          }}
          {...props}
        >
          {children}
        </th>
      );
    },

    // Table data cell style
    td({ children, ...props }) {
      return (
        <td
          className="border-t px-5 py-3 text-base"
          style={{
            borderColor: 'var(--md-table-divide)',
            color: 'var(--md-table-cell-text)',
          }}
          {...props}
        >
          {children}
        </td>
      );
    },

    // Blockquote style
    blockquote({ children, ...props }) {
      return (
        <blockquote
          className="my-5 border-l-4 py-3 pl-5"
          style={{
            backgroundColor: 'var(--md-blockquote-bg)',
            borderColor: 'var(--md-blockquote-border)',
            color: 'var(--md-blockquote-text)',
          }}
          {...props}
        >
          {children}
        </blockquote>
      );
    },

    // Paragraph style - remove all margin so it behaves like a normal line break
    p({ children, ...props }) {
      return (
        <p
          className="my-0 text-base leading-relaxed" // Remove all vertical margin
          style={{
            color: 'var(--md-think-content-text)',
          }}
          {...props}
        >
          {children}
        </p>
      );
    },

    // Heading styles
    h1({ children, ...props }) {
      return (
        <h1
          className="my-5 text-2xl font-bold"
          style={{
            color: 'var(--md-think-content-text)',
          }}
          {...props}
        >
          {children}
        </h1>
      );
    },

    h2({ children, ...props }) {
      return (
        <h2
          className="my-4 text-xl font-bold"
          style={{
            color: 'var(--md-think-content-text)',
          }}
          {...props}
        >
          {children}
        </h2>
      );
    },

    h3({ children, ...props }) {
      return (
        <h3
          className="my-3 text-lg font-semibold"
          style={{
            color: 'var(--md-think-content-text)',
          }}
          {...props}
        >
          {children}
        </h3>
      );
    },

    // List styles
    ul({ children, ...props }) {
      return (
        <ul
          className="my-4 list-disc space-y-2 pl-6 text-base"
          style={{
            color: 'var(--md-think-content-text)',
          }}
          {...props}
        >
          {children}
        </ul>
      );
    },

    ol({ children, ...props }) {
      return (
        <ol
          className="my-4 list-decimal space-y-2 pl-6 text-base"
          style={{
            color: 'var(--md-think-content-text)',
          }}
          {...props}
        >
          {children}
        </ol>
      );
    },

    // Link styles
    a({ children, node, ...props }) {
      // Check if the link contains an image: if so, render as an image link style
      // Avoid nested <a> tags which cause HTML errors
      const hasImageChild = node?.children?.some(child => isImageTag(child));

      if (hasImageChild) {
        // If the link contains an image, use a special image link style
        const imageChild = node?.children?.find(child => isImageTag(child));
        const alt = getNodeAlt(imageChild) || t('imageLink');

        return (
          <a
            className="inline-flex items-center gap-1 rounded border px-2 py-1 text-sm no-underline"
            style={{
              borderColor: 'var(--md-think-content-border)',
              backgroundColor: 'var(--md-think-content-bg)',
              color: 'var(--md-think-content-text)',
              opacity: 0.9,
            }}
            target="_blank"
            rel="noopener noreferrer"
            title={t('clickToViewWithAlt', { alt })}
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
            {alt}
          </a>
        );
      }

      // Normal link handling
      return (
        <a
          className="underline"
          style={{
            color: 'var(--md-think-content-text)',
            opacity: 0.9,
          }}
          {...props}
        >
          {children}
        </a>
      );
    },

    // Image handling: render images as links to avoid loading flicker
    // If the image is inside a link, let the parent a component handle it, return null here to avoid duplicate rendering
    img({ src, alt, node }) {
      // Ensure src is a string
      const imageUrl = typeof src === 'string' ? src : '';

      // Check if inside a link (handled by parent a component)
      const isInsideLink = hasAnchorParent(node);

      if (isInsideLink) {
        // If inside a link, return null, handled by parent a component
        return null;
      }

      // Standalone image, create an image link
      return (
        <a
          href={imageUrl}
          className="inline-flex items-center gap-1 rounded border px-2 py-1 text-sm"
          style={{
            borderColor: 'var(--md-think-content-border)',
            backgroundColor: 'var(--md-think-content-bg)',
            color: 'var(--md-think-content-text)',
            opacity: 0.9,
          }}
          target="_blank"
          rel="noopener noreferrer"
          title={alt || t('viewImage')}
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
          {alt || t('imageLink')}
        </a>
      );
    },
  };

  // --- Optimized animation variants ---
  const variants = {
    open: {
      opacity: 1,
      height: 'auto',
      scale: 1,
      y: 0,
      transition: {
        type: 'spring', // Use spring animation
        stiffness: 300, // Spring stiffness
        damping: 24, // Damping, higher value means animation ends faster
        mass: 0.8, // Mass, lower value means faster animation
        height: { type: 'spring', stiffness: 100, damping: 30 }, // Height uses a softer spring
      },
    },
    closed: {
      opacity: 0,
      height: 0,
      scale: 0.95,
      y: -8,
      transition: {
        type: 'spring',
        stiffness: 300,
        damping: 25,
        height: { delay: 0.1, type: 'spring', stiffness: 200, damping: 30 }, // Slightly delay height change
      },
    },
  };

  return (
    <motion.div
      className="mb-2 origin-top overflow-hidden" // Add origin-top and move margin-bottom here
      initial={false} // Do not use initial to avoid flicker on first render
      animate={isOpen ? 'open' : 'closed'} // Switch state based on isOpen
      variants={variants}
    >
      <div
        id="think-block-content"
        className="think-block-content markdown-body w-full max-w-full flex-1 transform-gpu rounded-md border p-5 font-serif text-base"
        style={{
          backgroundColor: 'var(--md-think-content-bg)',
          borderColor: 'var(--md-think-content-border)',
          color: 'var(--md-think-content-text)',
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex, rehypeRaw]}
          components={markdownComponents}
        >
          {processedContent}
        </ReactMarkdown>
      </div>
    </motion.div>
  );
};
