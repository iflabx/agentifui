import { mapChatUploadFilesToMessageAttachments } from './file-mappers';

describe('mapChatUploadFilesToMessageAttachments', () => {
  it('persists the resolved appId on each attachment', () => {
    const attachments = mapChatUploadFilesToMessageAttachments(
      [
        {
          type: 'document',
          transfer_method: 'local_file',
          upload_file_id: 'file-1',
          name: 'notes.md',
          size: 128,
          mime_type: 'text/markdown',
          preview_url: 'https://dify.example/files/file-1/file-preview?sign=1',
        },
      ],
      'route-app'
    );

    expect(attachments).toEqual([
      {
        id: 'file-1',
        name: 'notes.md',
        size: 128,
        type: 'text/markdown',
        upload_file_id: 'file-1',
        preview_url: 'https://dify.example/files/file-1/file-preview?sign=1',
        app_id: 'route-app',
      },
    ]);
  });
});
