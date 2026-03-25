/** @jest-environment node */
import {
  createUploadFiles,
  getDifyFileType,
  getFileSizeHint,
  getFileTypeInfo,
  getMaxFiles,
  getSuccessfulFilesPayload,
  isProcessedFileItem,
} from '@components/workflow/workflow-input-form/file-upload-field/helpers';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

describe('file upload field helpers', () => {
  it('detects processed files and creates upload file state', () => {
    expect(isProcessedFileItem({ upload_file_id: 'file-1' })).toBe(true);
    expect(isProcessedFileItem({ id: 'x' })).toBe(false);

    const file = new File(['demo'], 'demo.txt', { type: 'text/plain' });
    const [uploadFile] = createUploadFiles([file]);
    expect(uploadFile.name).toBe('demo.txt');
    expect(uploadFile.status).toBe('pending');
  });

  it('maps dify file types and success payloads', () => {
    expect(getDifyFileType({ type: 'image/png' } as never)).toBe('image');
    expect(getDifyFileType({ type: 'application/pdf' } as never)).toBe(
      'document'
    );

    expect(
      getSuccessfulFilesPayload(
        [
          {
            type: 'image/png',
            status: 'success',
            uploadedId: 'file-1',
            name: 'demo.png',
            size: 12,
          },
        ] as never,
        true
      )
    ).toEqual({
      successIds: 'file-1',
      value: {
        type: 'image',
        transfer_method: 'local_file',
        upload_file_id: 'file-1',
        name: 'demo.png',
        size: 12,
        mime_type: 'image/png',
      },
    });
  });

  it('builds upload limits and type hints', () => {
    expect(getMaxFiles({ max_length: 3 }, false)).toBe(3);
    expect(getMaxFiles({}, true)).toBe(1);

    const info = getFileTypeInfo({ allowed_file_types: ['image', 'audio'] }, t);
    expect(info.hint).toContain('supportTypes');
    expect(info.accept).toContain('image/*');
    expect(getFileSizeHint({ max_file_size_mb: 10 }, t)).toContain(
      'maxFileSize'
    );
  });
});
