import { render, screen } from '@testing-library/react';

import { CodeBlockHeader } from './code-block-header';

interface ActionButtonMockProps {
  content?: string;
  language?: string;
  tooltipPlacement?: 'top' | 'bottom' | 'left' | 'right';
  'aria-label'?: string;
}

// Mock the child components
jest.mock('./copy-button', () => ({
  CopyButton: ({
    content,
    tooltipPlacement,
    'aria-label': ariaLabel,
  }: ActionButtonMockProps) => (
    <button
      data-testid="copy-button"
      data-content={content}
      data-tooltip={tooltipPlacement}
      aria-label={ariaLabel}
    >
      Copy
    </button>
  ),
}));

jest.mock('./export-button', () => ({
  ExportButton: ({
    content,
    language,
    tooltipPlacement,
    'aria-label': ariaLabel,
  }: ActionButtonMockProps) => (
    <button
      data-testid="export-button"
      data-content={content}
      data-language={language}
      data-tooltip={tooltipPlacement}
      aria-label={ariaLabel}
    >
      Export
    </button>
  ),
}));

describe('CodeBlockHeader', () => {
  describe('Rendering', () => {
    it('should not render when language is null', () => {
      const { container } = render(<CodeBlockHeader language={null} />);
      expect(container.firstChild).toBeNull();
    });

    it('should render header with language when language is provided', () => {
      const { container } = render(<CodeBlockHeader language="javascript" />);

      expect(screen.getByText('JavaScript')).toBeInTheDocument();
      expect(container.querySelector('svg')).toBeInTheDocument();
    });

    it('should use language mapping for TypeScript', () => {
      render(<CodeBlockHeader language="typescript" />);
      expect(screen.getByText('TypeScript')).toBeInTheDocument();
    });

    it('should handle single character languages', () => {
      render(<CodeBlockHeader language="c" />);
      expect(screen.getByText('C')).toBeInTheDocument();
    });

    it('should not render when language is empty string', () => {
      const { container } = render(<CodeBlockHeader language="" />);
      expect(container.firstChild).toBeNull();
    });
  });

  describe('Language Display Mapping', () => {
    it('should use proper display names for common languages', () => {
      const testCases = [
        { input: 'js', expected: 'JavaScript' },
        { input: 'ts', expected: 'TypeScript' },
        { input: 'tsx', expected: 'TSX' },
        { input: 'jsx', expected: 'JSX' },
        { input: 'c++', expected: 'C++' },
        { input: 'objective-c', expected: 'Objective-C' },
        { input: 'sh', expected: 'Shell' },
        { input: 'bash', expected: 'Bash' },
        { input: 'md', expected: 'Markdown' },
        { input: 'yml', expected: 'YAML' },
        { input: 'dockerfile', expected: 'Dockerfile' },
        { input: 'graphql', expected: 'GraphQL' },
      ];

      testCases.forEach(({ input, expected }) => {
        const { unmount } = render(<CodeBlockHeader language={input} />);
        expect(screen.getByText(expected)).toBeInTheDocument();
        unmount();
      });
    });

    it('should handle case insensitive mapping', () => {
      render(<CodeBlockHeader language="JAVASCRIPT" />);
      expect(screen.getByText('JavaScript')).toBeInTheDocument();
    });

    it('should fallback to capitalization for unmapped languages', () => {
      render(<CodeBlockHeader language="custom-lang" />);
      expect(screen.getByText('Custom-Lang')).toBeInTheDocument();
    });
  });

  describe('Internationalization and Special Characters', () => {
    it('should handle languages with non-Latin characters', () => {
      render(<CodeBlockHeader language="中文" />);
      expect(screen.getByText('中文')).toBeInTheDocument();
    });

    it('should handle languages with mixed separators', () => {
      render(<CodeBlockHeader language="vue.js_component" />);
      expect(screen.getByText('Vue.Js_Component')).toBeInTheDocument();
    });

    it('should handle extremely long language names', () => {
      const longLanguage =
        'this-is-a-very-long-custom-programming-language-name';
      render(<CodeBlockHeader language={longLanguage} />);

      const displayedText =
        'This-Is-A-Very-Long-Custom-Programming-Language-Name';
      expect(screen.getByText(displayedText)).toBeInTheDocument();
    });
  });

  describe('Action Buttons', () => {
    it('should not render action buttons when codeContent is not provided', () => {
      render(<CodeBlockHeader language="javascript" />);

      expect(screen.queryByTestId('copy-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('export-button')).not.toBeInTheDocument();
    });

    it('should render action buttons when codeContent is provided', () => {
      const codeContent = 'console.log("Hello World");';
      render(
        <CodeBlockHeader language="javascript" codeContent={codeContent} />
      );

      const copyButton = screen.getByTestId('copy-button');
      const exportButton = screen.getByTestId('export-button');

      expect(copyButton).toBeInTheDocument();
      expect(exportButton).toBeInTheDocument();

      expect(copyButton).toHaveAttribute('data-content', codeContent);
      expect(copyButton).toHaveAttribute('data-tooltip', 'bottom');

      expect(exportButton).toHaveAttribute('data-content', codeContent);
      expect(exportButton).toHaveAttribute('data-language', 'javascript');
      expect(exportButton).toHaveAttribute('data-tooltip', 'bottom');
    });

    it('should not render action buttons with empty codeContent', () => {
      render(<CodeBlockHeader language="javascript" codeContent="" />);

      expect(screen.queryByTestId('copy-button')).not.toBeInTheDocument();
      expect(screen.queryByTestId('export-button')).not.toBeInTheDocument();
    });
  });

  describe('Layout and Overflow Prevention', () => {
    it('should apply essential layout classes for overflow prevention', () => {
      const { container } = render(<CodeBlockHeader language="javascript" />);
      const header = container.firstChild as HTMLElement;

      // Essential layout classes for overflow prevention
      expect(header).toHaveClass('flex');
      expect(header).toHaveClass('justify-between');
      expect(header).toHaveClass('min-w-0');
      expect(header).toHaveClass('gap-2'); // For spacing between sections
    });

    it('should apply custom className when provided', () => {
      const { container } = render(
        <CodeBlockHeader language="javascript" className="custom-class" />
      );
      const header = container.firstChild as HTMLElement;

      expect(header).toHaveClass('custom-class');
    });

    it('should apply text truncation to language span', () => {
      render(<CodeBlockHeader language="javascript" />);
      const languageSpan = screen.getByText('JavaScript');

      expect(languageSpan).toHaveClass('truncate');
    });

    it('should apply flex layout classes for overflow prevention', () => {
      const { container } = render(
        <CodeBlockHeader language="javascript" codeContent="test" />
      );
      const header = container.firstChild as HTMLElement;

      // Left section should have flex-1 and min-w-0 for text truncation
      const leftSection = header.querySelector('.flex-1');
      expect(leftSection).toHaveClass('flex-1');
      expect(leftSection).toHaveClass('min-w-0');

      // Right section should have flex-shrink-0 to prevent shrinking
      const rightSection = header.querySelector('.flex-shrink-0');
      expect(rightSection).toBeInTheDocument();
    });
  });

  describe('Accessibility', () => {
    it('should provide title attribute for truncated text', () => {
      render(<CodeBlockHeader language="javascript" />);
      const languageSpan = screen.getByText('JavaScript');

      expect(languageSpan).toHaveAttribute('title', 'JavaScript');
    });

    it('should provide aria-labels for action buttons', () => {
      render(<CodeBlockHeader language="c++" codeContent="int main() {}" />);

      const copyButton = screen.getByTestId('copy-button');
      const exportButton = screen.getByTestId('export-button');

      expect(copyButton).toHaveAttribute('aria-label', 'Copy C++ code');
      expect(exportButton).toHaveAttribute('aria-label', 'Export C++ code');
    });

    it('should have proper semantic structure', () => {
      render(<CodeBlockHeader language="javascript" codeContent="test" />);

      const { container } = render(<CodeBlockHeader language="javascript" />);
      expect((container.firstChild as Element)?.tagName.toLowerCase()).toBe(
        'div'
      );
    });

    it('should make language text non-selectable', () => {
      render(<CodeBlockHeader language="javascript" />);
      const languageSpan = screen.getByText('JavaScript');

      expect(languageSpan).toHaveClass('select-none');
    });
  });

  describe('CSS Variables and Styling', () => {
    it('should apply correct CSS custom properties', () => {
      const { container } = render(<CodeBlockHeader language="javascript" />);
      const header = container.firstChild as HTMLElement;

      expect(header.style.backgroundColor).toBe('var(--md-code-header-bg)');
      expect(header.style.borderColor).toBe('var(--md-code-header-border)');
      expect(header.style.color).toBe('var(--md-code-header-text)');
    });
  });

  describe('Text Overflow Handling', () => {
    it('should handle very long language names while maintaining button accessibility', () => {
      const longLanguage = 'supercalifragilisticexpialidocious-script-language';
      render(<CodeBlockHeader language={longLanguage} codeContent="test" />);

      // Should still render the language text (with proper capitalization)
      expect(
        screen.getByText('Supercalifragilisticexpialidocious-Script-Language')
      ).toBeInTheDocument();

      // Action buttons should still be visible and accessible
      expect(screen.getByTestId('copy-button')).toBeInTheDocument();
      expect(screen.getByTestId('export-button')).toBeInTheDocument();
    });

    it('should maintain button visibility with long content', () => {
      const longCode = 'a'.repeat(1000); // Very long code content
      render(
        <CodeBlockHeader
          language="verylonglanguagename"
          codeContent={longCode}
        />
      );

      // Buttons should still be rendered and accessible
      const copyButton = screen.getByTestId('copy-button');
      const exportButton = screen.getByTestId('export-button');

      expect(copyButton).toBeInTheDocument();
      expect(exportButton).toBeInTheDocument();
      expect(copyButton).toHaveAttribute('data-content', longCode);
    });
  });
});
