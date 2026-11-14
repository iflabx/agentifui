import { useAttachmentStore } from '@lib/stores/attachment-store';
import { fireEvent, render, screen } from '@testing-library/react';

import { AttachmentPreviewItem } from './attachment-preview-item';

// Mock the attachment store
jest.mock('@lib/stores/attachment-store', () => ({
  useAttachmentStore: jest.fn(),
}));

// Mock next-intl
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock the spinner component
jest.mock('@components/ui/spinner', () => ({
  Spinner: ({ size }: { size?: string }) => (
    <div data-testid="spinner" data-size={size} />
  ),
}));

// Mock tooltip wrapper
jest.mock('@components/ui/tooltip-wrapper', () => ({
  TooltipWrapper: ({
    children,
    content,
  }: {
    children: React.ReactNode;
    content: string;
  }) => <div data-tooltip={content}>{children}</div>,
}));

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
  CheckCircle2Icon: () => <div data-testid="success-icon" />,
  FileTextIcon: () => <div data-testid="file-icon" />,
  RotateCcw: () => <div data-testid="retry-icon" />,
  XIcon: () => <div data-testid="remove-icon" />,
}));

describe('AttachmentPreviewItem', () => {
  const mockRemoveFile = jest.fn();
  const mockOnRetry = jest.fn();

  const createMockFile = (): File => {
    return new File(['test content'], 'test-file.txt', { type: 'text/plain' });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useAttachmentStore as jest.MockedFunction<any>).mockReturnValue(
      mockRemoveFile
    );
  });

  const baseAttachment = {
    id: 'test-file-123',
    file: createMockFile(),
    name: 'test-file.txt',
    size: 1024,
    type: 'text/plain',
  };

  describe('Status Display', () => {
    it('displays spinner when uploading', () => {
      const attachment = { ...baseAttachment, status: 'uploading' as const };

      render(
        <AttachmentPreviewItem
          attachment={attachment}
          onRetry={mockOnRetry}
          onRemove={mockRemoveFile}
        />
      );

      expect(screen.getByTestId('spinner')).toBeInTheDocument();
      expect(screen.getByTestId('spinner')).toHaveAttribute('data-size', 'sm');
    });

    it('displays success icon when upload successful', () => {
      const attachment = { ...baseAttachment, status: 'success' as const };

      render(
        <AttachmentPreviewItem
          attachment={attachment}
          onRetry={mockOnRetry}
          onRemove={mockRemoveFile}
        />
      );

      expect(screen.getByTestId('success-icon')).toBeInTheDocument();
    });

    it('displays retry button when upload failed', () => {
      const attachment = {
        ...baseAttachment,
        status: 'error' as const,
        error: 'Upload failed',
      };

      render(
        <AttachmentPreviewItem
          attachment={attachment}
          onRetry={mockOnRetry}
          onRemove={mockRemoveFile}
        />
      );

      expect(screen.getByTestId('retry-icon')).toBeInTheDocument();
    });

    it('displays file icon for pending status', () => {
      const attachment = { ...baseAttachment, status: 'pending' as const };

      render(
        <AttachmentPreviewItem
          attachment={attachment}
          onRetry={mockOnRetry}
          onRemove={mockRemoveFile}
        />
      );

      expect(screen.getByTestId('file-icon')).toBeInTheDocument();
    });
  });

  describe('File Information Display', () => {
    it('displays file name and size', () => {
      const attachment = { ...baseAttachment, status: 'pending' as const };

      render(
        <AttachmentPreviewItem
          attachment={attachment}
          onRetry={mockOnRetry}
          onRemove={mockRemoveFile}
        />
      );

      expect(screen.getByText('test-file.txt')).toBeInTheDocument();
      expect(screen.getByText('1 KB')).toBeInTheDocument(); // formatBytes utility
    });

    it('displays error message in title when upload failed', () => {
      const attachment = {
        ...baseAttachment,
        status: 'error' as const,
        error: 'Network error',
      };

      render(
        <AttachmentPreviewItem
          attachment={attachment}
          onRetry={mockOnRetry}
          onRemove={mockRemoveFile}
        />
      );

      const container = screen.getByTitle('error: Network error');
      expect(container).toBeInTheDocument();
    });
  });

  describe('User Interactions', () => {
    it('calls onRetry when retry button is clicked', async () => {
      const attachment = {
        ...baseAttachment,
        status: 'error' as const,
        error: 'Upload failed',
      };

      render(
        <AttachmentPreviewItem
          attachment={attachment}
          onRetry={mockOnRetry}
          onRemove={mockRemoveFile}
        />
      );

      const retryButton = screen.getByRole('button', { name: 'retry' });
      fireEvent.click(retryButton);

      expect(mockOnRetry).toHaveBeenCalledWith('test-file-123');
    });

    it('calls removeFile when remove button is clicked', async () => {
      const attachment = { ...baseAttachment, status: 'pending' as const };

      render(
        <AttachmentPreviewItem
          attachment={attachment}
          onRetry={mockOnRetry}
          onRemove={mockRemoveFile}
        />
      );

      const removeButton = screen.getByRole('button', { name: 'remove' });
      fireEvent.click(removeButton);

      expect(mockRemoveFile).toHaveBeenCalledWith('test-file-123');
    });

    it('prevents event propagation on button clicks', () => {
      const mockContainerClick = jest.fn();
      const attachment = { ...baseAttachment, status: 'pending' as const };

      render(
        <div onClick={mockContainerClick}>
          <AttachmentPreviewItem
            attachment={attachment}
            onRetry={mockOnRetry}
            onRemove={mockRemoveFile}
          />
        </div>
      );

      const removeButton = screen.getByRole('button', { name: 'remove' });
      fireEvent.click(removeButton);

      // Container click should not be triggered due to stopPropagation
      expect(mockContainerClick).not.toHaveBeenCalled();
    });
  });

  describe('Theme Support', () => {
    it('applies light mode classes by default', () => {
      const attachment = { ...baseAttachment, status: 'success' as const };

      render(
        <AttachmentPreviewItem
          attachment={attachment}
          onRetry={mockOnRetry}
          onRemove={mockRemoveFile}
        />
      );

      const container = screen.getByTitle('test-file.txt');
      expect(container).toHaveClass('border-stone-200', 'bg-stone-100');
    });

    it('includes dark mode classes with dark: prefix', () => {
      const attachment = { ...baseAttachment, status: 'success' as const };

      render(
        <AttachmentPreviewItem
          attachment={attachment}
          onRetry={mockOnRetry}
          onRemove={mockRemoveFile}
        />
      );

      const container = screen.getByTitle('test-file.txt');
      expect(container).toHaveClass(
        'dark:border-stone-700/80',
        'dark:bg-stone-800/90'
      );
    });
  });

  describe('Error State Styling', () => {
    it('applies light error border when status is error', () => {
      const attachment = {
        ...baseAttachment,
        status: 'error' as const,
        error: 'Upload failed',
      };

      render(
        <AttachmentPreviewItem
          attachment={attachment}
          onRetry={mockOnRetry}
          onRemove={mockRemoveFile}
        />
      );

      const container = screen.getByTitle('error: Upload failed');
      expect(container).toHaveClass('border-red-400/30');
    });

    it('includes dark error border classes with dark: prefix', () => {
      const attachment = {
        ...baseAttachment,
        status: 'error' as const,
        error: 'Upload failed',
      };

      render(
        <AttachmentPreviewItem
          attachment={attachment}
          onRetry={mockOnRetry}
          onRemove={mockRemoveFile}
        />
      );

      const container = screen.getByTitle('error: Upload failed');
      expect(container).toHaveClass('dark:border-red-500/30');
    });
  });
});
