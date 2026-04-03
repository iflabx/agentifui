import { previewDifyFile } from '@lib/services/dify/file-service';
import type { MessageAttachment } from '@lib/stores/chat-store';

import { useFilePreviewCacheStore } from './file-preview-cache-store';
import { useFilePreviewStore } from './file-preview-store';

jest.mock('@lib/services/dify/file-service', () => ({
  previewDifyFile: jest.fn(),
}));

describe('useFilePreviewStore', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useFilePreviewCacheStore.getState().clear();
    useFilePreviewStore.setState({
      isPreviewOpen: false,
      currentPreviewFile: null,
      isLoading: false,
      error: null,
      previewContent: null,
      contentHeaders: null,
    });
  });

  const mockedPreviewDifyFile = jest.mocked(previewDifyFile);

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

  it('prefers file.app_id over the external appId when previewing', async () => {
    mockedPreviewDifyFile.mockResolvedValue({
      content: new Blob(['preview']),
      headers: {
        contentType: 'text/markdown',
      },
    });

    await useFilePreviewStore
      .getState()
      .openPreview(
        createAttachment({ app_id: 'attachment-app' }),
        'current-app'
      );

    expect(mockedPreviewDifyFile).toHaveBeenCalledWith(
      'attachment-app',
      'file-1',
      { as_attachment: false }
    );
    expect(useFilePreviewStore.getState().currentPreviewFile).toEqual(
      expect.objectContaining({
        app_id: 'attachment-app',
      })
    );
  });

  it('stores the fallback appId on the preview file when attachment app_id is missing', async () => {
    mockedPreviewDifyFile.mockResolvedValue({
      content: new Blob(['preview']),
      headers: {
        contentType: 'text/markdown',
      },
    });

    await useFilePreviewStore
      .getState()
      .openPreview(createAttachment(), 'current-app');

    expect(mockedPreviewDifyFile).toHaveBeenCalledWith(
      'current-app',
      'file-1',
      { as_attachment: false }
    );
    expect(useFilePreviewStore.getState().currentPreviewFile).toEqual(
      expect.objectContaining({
        app_id: 'current-app',
      })
    );
  });

  it('prefers preview_file_id over upload_file_id for preview requests and caching', async () => {
    mockedPreviewDifyFile.mockResolvedValue({
      content: new Blob(['preview']),
      headers: {
        contentType: 'text/markdown',
      },
    });

    await useFilePreviewStore.getState().openPreview(
      createAttachment({
        app_id: 'attachment-app',
        preview_file_id: 'preview-file-1',
      })
    );

    expect(mockedPreviewDifyFile).toHaveBeenCalledWith(
      'attachment-app',
      'preview-file-1',
      { as_attachment: false }
    );
  });
});
