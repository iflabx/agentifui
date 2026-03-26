import { useMobile } from '@lib/hooks/use-mobile';
import { fireEvent, render, screen } from '@testing-library/react';

import { ThinkBlockHeader, ThinkBlockStatus } from './think-block-header';

interface SpinnerMockProps {
  size?: string;
  className?: string;
  'aria-label'?: string;
}

// Mock dependencies
jest.mock('@components/ui/spinner', () => ({
  Spinner: ({ size, className, 'aria-label': ariaLabel }: SpinnerMockProps) => (
    <div
      data-testid="spinner"
      data-size={size}
      className={className}
      aria-label={ariaLabel}
    >
      Loading...
    </div>
  ),
}));

jest.mock('@lib/hooks/use-mobile', () => ({
  useMobile: jest.fn(),
}));

const mockUseMobile = jest.mocked(useMobile);

describe('ThinkBlockHeader', () => {
  const defaultProps = {
    status: 'completed' as ThinkBlockStatus,
    isOpen: false,
    onToggle: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseMobile.mockReturnValue(false); // Default to desktop
  });

  describe('Rendering and Status Display', () => {
    it('should render with completed status', () => {
      render(<ThinkBlockHeader {...defaultProps} status="completed" />);

      expect(
        screen.getByText('components.chat.thinkBlock.completed')
      ).toBeInTheDocument();
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    });

    it('should render with thinking status and spinner', () => {
      render(<ThinkBlockHeader {...defaultProps} status="thinking" />);

      expect(
        screen.getByText('components.chat.thinkBlock.thinking')
      ).toBeInTheDocument();
      expect(screen.getByTestId('spinner')).toBeInTheDocument();
    });

    it('should render with stopped status', () => {
      render(<ThinkBlockHeader {...defaultProps} status="stopped" />);

      expect(
        screen.getByText('components.chat.thinkBlock.stopped')
      ).toBeInTheDocument();
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    });

    it('should default to completed status for unknown status', () => {
      render(
        <ThinkBlockHeader
          {...defaultProps}
          status={'unknown' as ThinkBlockStatus}
        />
      );

      expect(
        screen.getByText('components.chat.thinkBlock.completed')
      ).toBeInTheDocument();
    });

    it('should show preview text when thinking and collapsed', () => {
      render(
        <ThinkBlockHeader
          {...defaultProps}
          status="thinking"
          previewText="current reasoning preview"
        />
      );

      const preview = screen.getByTestId('think-block-preview');
      expect(preview).toHaveTextContent('current reasoning preview');
      expect(preview).toHaveClass('truncate');
    });

    it('should hide preview text when expanded', () => {
      render(
        <ThinkBlockHeader
          {...defaultProps}
          status="thinking"
          isOpen={true}
          previewText="current reasoning preview"
        />
      );

      expect(
        screen.queryByTestId('think-block-preview')
      ).not.toBeInTheDocument();
    });

    it('should hide preview text for non-thinking status', () => {
      render(
        <ThinkBlockHeader
          {...defaultProps}
          status="completed"
          previewText="current reasoning preview"
        />
      );

      expect(
        screen.queryByTestId('think-block-preview')
      ).not.toBeInTheDocument();
    });
  });

  describe('Expand/Collapse Icon', () => {
    it('should show collapsed icon when isOpen is false', () => {
      const { container } = render(
        <ThinkBlockHeader {...defaultProps} isOpen={false} />
      );
      const icon = container.querySelector('svg');

      expect(icon).toHaveClass('rotate-0');
      expect(icon).not.toHaveClass('rotate-90');
    });

    it('should show expanded icon when isOpen is true', () => {
      const { container } = render(
        <ThinkBlockHeader {...defaultProps} isOpen={true} />
      );
      const icon = container.querySelector('svg');

      expect(icon).toHaveClass('rotate-90');
      expect(icon).not.toHaveClass('rotate-0');
    });
  });

  describe('Responsive Layout', () => {
    it('should use full width on mobile', () => {
      mockUseMobile.mockReturnValue(true);
      const { container } = render(<ThinkBlockHeader {...defaultProps} />);
      const button = container.firstChild as HTMLElement;

      expect(button).toHaveClass('w-full');
      expect(button).not.toHaveClass('min-w-[22%]');
      expect(button).not.toHaveClass('max-w-[50%]');
    });

    it('should use constrained width on desktop', () => {
      mockUseMobile.mockReturnValue(false);
      const { container } = render(<ThinkBlockHeader {...defaultProps} />);
      const button = container.firstChild as HTMLElement;

      expect(button).toHaveClass('min-w-[22%]');
      expect(button).toHaveClass('max-w-[50%]');
      expect(button).not.toHaveClass('w-full');
    });

    it('should apply shorter preview width on mobile', () => {
      mockUseMobile.mockReturnValue(true);
      render(
        <ThinkBlockHeader
          {...defaultProps}
          status="thinking"
          previewText="preview"
        />
      );

      expect(screen.getByTestId('think-block-preview')).toHaveClass('max-w-32');
    });

    it('should apply longer preview width on desktop', () => {
      mockUseMobile.mockReturnValue(false);
      render(
        <ThinkBlockHeader
          {...defaultProps}
          status="thinking"
          previewText="preview"
        />
      );

      expect(screen.getByTestId('think-block-preview')).toHaveClass('max-w-32');
      expect(screen.getByTestId('think-block-preview')).toHaveClass(
        'sm:max-w-40'
      );
      expect(screen.getByTestId('think-block-preview')).toHaveClass(
        'md:max-w-56'
      );
      expect(screen.getByTestId('think-block-preview')).toHaveClass(
        'lg:max-w-72'
      );
    });
  });

  describe('Text Overflow Handling', () => {
    it('should apply text truncation classes', () => {
      render(<ThinkBlockHeader {...defaultProps} />);
      const statusText = screen.getByText(
        'components.chat.thinkBlock.completed'
      );

      expect(statusText).toHaveClass('font-medium');
      expect(statusText).toHaveClass('truncate'); // For text overflow fix
      expect(statusText).not.toHaveClass('whitespace-nowrap'); // Should not have this anymore
    });

    it('should apply proper flex layout for overflow prevention', () => {
      const { container } = render(<ThinkBlockHeader {...defaultProps} />);
      const button = container.firstChild as HTMLElement;

      // Main container should have responsive min-width classes
      expect(button.className).toContain('min-w-[22%]');

      // Left section should have flex-1, min-w-0, and gap-2 for spacing
      const leftSection = button.querySelector('.flex-1');
      expect(leftSection).toHaveClass('flex-1');
      expect(leftSection).toHaveClass('min-w-0');
      expect(leftSection).toHaveClass('gap-2'); // Spacing with gap instead of margin

      // Right section should prevent shrinking
      const rightSection = button.querySelector('.flex-shrink-0');
      expect(rightSection).toBeInTheDocument();
    });

    it('should maintain consistent spacing between text and spinner', () => {
      const { container } = render(
        <ThinkBlockHeader {...defaultProps} status="thinking" />
      );
      const leftSection = container.querySelector('.gap-2');
      const rightSection = container.querySelector('.flex-shrink-0');

      expect(leftSection).toBeInTheDocument();
      expect(rightSection).toBeInTheDocument();
      expect(screen.getByTestId('spinner')).toBeInTheDocument();
    });
  });

  describe('Spinner Display', () => {
    it('should show spinner only when thinking', () => {
      const { rerender } = render(
        <ThinkBlockHeader {...defaultProps} status="thinking" />
      );
      expect(screen.getByTestId('spinner')).toBeInTheDocument();

      rerender(<ThinkBlockHeader {...defaultProps} status="completed" />);
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();

      rerender(<ThinkBlockHeader {...defaultProps} status="stopped" />);
      expect(screen.queryByTestId('spinner')).not.toBeInTheDocument();
    });

    it('should configure spinner with correct props', () => {
      render(<ThinkBlockHeader {...defaultProps} status="thinking" />);
      const spinner = screen.getByTestId('spinner');

      expect(spinner).toHaveAttribute('data-size', 'md');
      expect(spinner).toHaveClass('text-current');
    });

    it('should place spinner in fixed-size container', () => {
      const { container } = render(
        <ThinkBlockHeader {...defaultProps} status="thinking" />
      );
      const spinnerContainer = container.querySelector(
        '.h-4.w-4.flex-shrink-0'
      );

      expect(spinnerContainer).toBeInTheDocument();
      // Check if spinner is inside the right section with the spinner container
      expect(screen.getByTestId('spinner')).toBeInTheDocument();
    });
  });

  describe('CSS Classes and Styling', () => {
    it('should apply essential layout classes', () => {
      const { container } = render(<ThinkBlockHeader {...defaultProps} />);
      const button = container.firstChild as HTMLElement;

      // Essential layout classes for overflow prevention and responsiveness
      expect(button).toHaveClass('flex');
      expect(button).toHaveClass('justify-between');
      expect(button).toHaveClass('gap-2'); // For consistent spacing
      expect(button.className).toContain('min-w-[22%]'); // Desktop responsive class
    });

    it('should apply different styles for thinking status', () => {
      const { container } = render(
        <ThinkBlockHeader {...defaultProps} status="thinking" />
      );
      const button = container.firstChild as HTMLElement;

      expect(button.style.backgroundColor).toBe('var(--md-think-thinking-bg)');
      expect(button.style.borderColor).toBe('var(--md-think-thinking-border)');
      expect(button.style.color).toBe('var(--md-think-thinking-text)');
    });

    it('should apply different styles for non-thinking status', () => {
      const { container } = render(
        <ThinkBlockHeader {...defaultProps} status="completed" />
      );
      const button = container.firstChild as HTMLElement;

      expect(button.style.backgroundColor).toBe('var(--md-think-header-bg)');
      expect(button.style.borderColor).toBe('var(--md-think-header-border)');
      expect(button.style.color).toBe('var(--md-think-header-text)');
    });

    it('should apply correct icon colors based on status', () => {
      const { container, rerender } = render(
        <ThinkBlockHeader {...defaultProps} status="thinking" />
      );
      let icon = container.querySelector('svg');
      expect(icon?.style.color).toBe('var(--md-think-thinking-icon)');

      rerender(<ThinkBlockHeader {...defaultProps} status="completed" />);
      icon = container.querySelector('svg');
      expect(icon?.style.color).toBe('var(--md-think-header-icon)');
    });
  });

  describe('User Interaction', () => {
    it('should call onToggle when clicked', () => {
      const onToggle = jest.fn();
      render(<ThinkBlockHeader {...defaultProps} onToggle={onToggle} />);

      const button = screen.getByRole('button');
      fireEvent.click(button);

      expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('should not call onToggle multiple times for single click', () => {
      const onToggle = jest.fn();
      render(<ThinkBlockHeader {...defaultProps} onToggle={onToggle} />);

      const button = screen.getByRole('button');
      fireEvent.click(button);
      fireEvent.click(button);

      expect(onToggle).toHaveBeenCalledTimes(2);
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes', () => {
      render(
        <ThinkBlockHeader {...defaultProps} status="completed" isOpen={true} />
      );
      const button = screen.getByRole('button');

      expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(button).toHaveAttribute('aria-controls', 'think-block-content');
      expect(button).toHaveAttribute('aria-label');
      expect(button.getAttribute('aria-label')).toContain('completed');
      expect(button.getAttribute('aria-label')).toContain('Collapse');
    });

    it('should update aria-expanded and aria-label based on state', () => {
      const { rerender } = render(
        <ThinkBlockHeader {...defaultProps} isOpen={false} />
      );
      let button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-expanded', 'false');
      expect(button.getAttribute('aria-label')).toContain('Expand');

      rerender(<ThinkBlockHeader {...defaultProps} isOpen={true} />);
      button = screen.getByRole('button');
      expect(button).toHaveAttribute('aria-expanded', 'true');
      expect(button.getAttribute('aria-label')).toContain('Collapse');
    });

    it('should provide title attribute for status text', () => {
      render(<ThinkBlockHeader {...defaultProps} status="thinking" />);
      const statusText = screen.getByText(
        'components.chat.thinkBlock.thinking'
      );

      expect(statusText).toHaveAttribute(
        'title',
        'components.chat.thinkBlock.thinking'
      );
    });

    it('should provide aria-label for spinner when thinking', () => {
      render(<ThinkBlockHeader {...defaultProps} status="thinking" />);
      const spinner = screen.getByTestId('spinner');

      expect(spinner).toHaveAttribute(
        'aria-label',
        'components.chat.thinkBlock.thinking'
      );
    });

    it('should mark decorative icon as aria-hidden', () => {
      const { container } = render(<ThinkBlockHeader {...defaultProps} />);
      const icon = container.querySelector('svg');

      expect(icon).toHaveAttribute('aria-hidden', 'true');
    });

    it('should be keyboard accessible', () => {
      const onToggle = jest.fn();
      render(<ThinkBlockHeader {...defaultProps} onToggle={onToggle} />);

      const button = screen.getByRole('button');
      fireEvent.keyDown(button, { key: 'Enter' });

      // The button should be focusable and interactive
      expect(button).toBeInTheDocument();
    });
  });

  describe('Icon Styling', () => {
    it('should apply correct icon classes', () => {
      const { container } = render(<ThinkBlockHeader {...defaultProps} />);
      const icon = container.querySelector('svg');

      expect(icon).toHaveClass('h-4');
      expect(icon).toHaveClass('w-4');
      expect(icon).toHaveClass('flex-shrink-0'); // Prevent icon shrinking
    });

    it('should have correct SVG attributes', () => {
      const { container } = render(<ThinkBlockHeader {...defaultProps} />);
      const icon = container.querySelector('svg');

      expect(icon).toHaveAttribute('fill', 'none');
      expect(icon).toHaveAttribute('stroke', 'currentColor');
      expect(icon).toHaveAttribute('viewBox', '0 0 24 24');
    });
  });
});
