'use client';

import { cn } from '@lib/utils';
import Prism from 'prismjs';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-c';
import 'prismjs/components/prism-cpp';
import 'prismjs/components/prism-csharp';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-markdown';
// Import base Prism style - actual style will use our CSS variables
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-yaml';

import React from 'react';

import { CodeBlockHeader } from './code-block-header';

// No need for useTheme, we use CSS variables for theme

interface CodeBlockProps {
  language: string | null;
  children: React.ReactNode;
  className?: string; // This className comes from react-markdown, e.g., "language-python"
  codeClassName?: string; // Additional class for the inner <code> element
  isStreaming?: boolean; // Indicates if the code is being streamed
}

function extractStringFromNode(node: React.ReactNode): string {
  if (typeof node === 'string') {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map(child => extractStringFromNode(child)).join('');
  }

  if (React.isValidElement(node)) {
    const element = node as React.ReactElement<{ children?: React.ReactNode }>;
    return extractStringFromNode(element.props.children);
  }

  return '';
}

// Use React.memo to prevent unnecessary re-renders
export const CodeBlock: React.FC<CodeBlockProps> = React.memo(
  ({
    language,
    children,
    className, // from react-markdown
    codeClassName, // for inner code tag
    isStreaming = false, // default: not streaming, code is complete
  }) => {
    // Extract code content for copy and highlight
    const codeContent = React.useMemo(() => {
      return extractStringFromNode(children);
    }, [children]);

    // Parse language name, e.g., "language-python" to "python"
    const parsedLanguage = React.useMemo(() => {
      if (!language) return 'text';
      if (language.startsWith('language-')) {
        return language.replace('language-', '');
      }
      return language;
    }, [language]);

    const codeRef = React.useRef<HTMLElement>(null);

    // Use useEffect to apply Prism highlight after mount or when content/state changes
    React.useEffect(() => {
      // Debug log: print useEffect trigger state (commented out)
      /*
      console.log(
        '[CodeBlock Effect]', 
        { 
          isStreaming, 
          codeContentExists: !!codeContent, 
          refExists: !!codeRef.current,
          language: parsedLanguage, 
          firstChars: codeContent?.slice(0,30) 
        }
      );
      */

      // Ensure Prism is loaded, code content exists, ref is attached, and not streaming
      if (!isStreaming && Prism && codeContent && codeRef.current) {
        // Debug log: ready to highlight (commented out)
        /*
        console.log('[CodeBlock Highlighting]', parsedLanguage, codeContent?.slice(0, 50));
        */
        Prism.highlightElement(codeRef.current);
      }
      // Dependencies: re-evaluate highlight logic when code content, language, or streaming state changes
      // When isStreaming changes from true to false, this effect will run and highlight
    }, [codeContent, parsedLanguage, isStreaming]);

    // Prism.highlightElement will directly modify the DOM,
    // so we don't need dangerouslySetInnerHTML or getHighlightedCode.
    // We just put codeContent into <code>, Prism.highlightElement will process it.
    return (
      <div
        className="my-3 transform-gpu rounded-lg border shadow-sm"
        style={{
          backgroundColor: 'var(--md-code-bg)',
          borderColor: 'var(--md-code-border)',
        }}
      >
        <CodeBlockHeader language={parsedLanguage} codeContent={codeContent} />
        <div className="overflow-hidden rounded-b-lg">
          <pre
            className={cn('overflow-x-auto p-4 font-mono text-sm', className)}
            style={{
              backgroundColor: 'var(--md-code-bg)',
            }}
          >
            <code
              ref={codeRef} // attach ref
              className={cn(`language-${parsedLanguage}`, codeClassName)}
              style={{ display: 'block' }} // ensure code block is block-level
            >
              {codeContent}{' '}
              {/* Directly render code content, Prism.highlightElement will process it */}
            </code>
          </pre>
        </div>
      </div>
    );
  }
);

CodeBlock.displayName = 'CodeBlock';
