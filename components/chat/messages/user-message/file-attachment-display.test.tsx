import type { MessageAttachment } from '@lib/stores/chat-store';
import { fireEvent, render, screen } from '@testing-library/react';

import { FileAttachmentDisplay } from './file-attachment-display';

const mockOpenPreview = jest.fn();
const mockHideMobileNav = jest.fn();
const mockToggleSidebar = jest.fn();

jest.mock('@lib/hooks/use-mobile', () => ({
  useMobile: () => false,
}));

jest.mock('@lib/stores/ui/file-preview-store', () => ({
  useFilePreviewStore: (
    selector: (state: { openPreview: typeof mockOpenPreview }) => unknown
  ) => selector({ openPreview: mockOpenPreview }),
}));

jest.mock('@lib/stores/sidebar-store', () => ({
  useSidebarStore: {
    getState: () => ({
      isMobileNavVisible: false,
      hideMobileNav: mockHideMobileNav,
      isExpanded: false,
      toggleSidebar: mockToggleSidebar,
    }),
  },
}));

describe('FileAttachmentDisplay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createAttachment = (
    overrides: Partial<MessageAttachment> = {}
  ): MessageAttachment => ({
    id: 'att-1',
    name: 'notes.md',
    size: 128,
    type: 'text/markdown',
    upload_file_id: 'file-1',
    ...overrides,
  });

  it('prefers attachment app_id over external current app when opening preview', () => {
    render(
      <FileAttachmentDisplay
        attachments={[createAttachment({ app_id: 'attachment-app' })]}
        appId="current-app"
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Preview file notes.md' })
    );

    expect(mockOpenPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        app_id: 'attachment-app',
        upload_file_id: 'file-1',
      }),
      'attachment-app'
    );
  });

  it('falls back to the external appId when attachment app_id is missing', () => {
    render(
      <FileAttachmentDisplay
        attachments={[createAttachment()]}
        appId="current-app"
      />
    );

    fireEvent.click(
      screen.getByRole('button', { name: 'Preview file notes.md' })
    );

    expect(mockOpenPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        app_id: 'current-app',
        upload_file_id: 'file-1',
      }),
      'current-app'
    );
  });
});
