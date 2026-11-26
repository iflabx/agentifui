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

  it('keeps the upload ID even when historical preview_file_id contains a message-file ID', async () => {
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
      'file-1',
      { as_attachment: false }
    );
  });

  it('downloads by stable upload ID, ignoring an old backend preview URL', async () => {
    mockedPreviewDifyFile.mockRejectedValueOnce(
      new Error('stop before creating browser URL')
    );
    useFilePreviewStore.setState({
      currentPreviewFile: createAttachment({
        app_id: 'attachment-app',
        preview_file_id: 'message-file-id',
        preview_url: 'https://dify.example/files/file-1/file-preview?sign=old',
      }),
    });
    await useFilePreviewStore.getState().downloadFile();
    expect(mockedPreviewDifyFile).toHaveBeenCalledWith(
      'attachment-app',
      'file-1',
      {
        as_attachment: true,
      }
    );
  });
});
