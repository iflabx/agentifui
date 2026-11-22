import {
  collectChatDisplayFiles,
  mapChatUploadFilesToDifyFiles,
  mapChatUploadFilesToMessageAttachments,
} from './file-mappers';

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

it('keeps field attachments in display/history without turning them into native files', () => {
  const source = {
    upload_file_id: 'source',
    name: 'brief.md',
    size: 12,
    mime_type: '',
  };
  const inputs = {
    SourceFile: source,
    ReferenceFiles: [source],
    Prompt: 'summarize',
  };
  const displayFiles = collectChatDisplayFiles([], inputs);
  expect(mapChatUploadFilesToMessageAttachments(displayFiles, 'app')).toEqual([
    expect.objectContaining({
      upload_file_id: 'source',
      name: 'brief.md',
      app_id: 'app',
    }),
  ]);
  expect(mapChatUploadFilesToDifyFiles([])).toBeUndefined();
  expect(inputs.SourceFile).toBe(source);
});

it('preserves native image types instead of labeling every upload a document', () => {
  expect(
    mapChatUploadFilesToDifyFiles([
      { name: 'photo.png', mime_type: '', upload_file_id: 'image' },
    ])
  ).toEqual([
    { type: 'image', transfer_method: 'local_file', upload_file_id: 'image' },
  ]);
});
