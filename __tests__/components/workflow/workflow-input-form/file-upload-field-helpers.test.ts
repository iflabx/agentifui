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
const slot = {
  key: 'docs',
  label: 'Docs',
  target: 'inputs' as const,
  minCount: 0,
  maxCount: 3,
  methods: ['local_file' as const],
  allowedTypes: ['image' as const, 'audio' as const],
  extensions: [],
  maxBytesByType: { image: 10, audio: 12 },
};

describe('file upload field helpers', () => {
  it('detects processed files and creates upload file state', () => {
    expect(isProcessedFileItem({ upload_file_id: 'file-1' })).toBe(true);
    expect(isProcessedFileItem({ id: 'x' })).toBe(false);

    const file = {
      name: 'demo.txt',
      lastModified: 123,
      size: 4,
      type: 'text/plain',
    } as File;
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
    expect(getMaxFiles(slot, false)).toBe(3);
    expect(getMaxFiles(slot, true)).toBe(1);
    expect(getMaxFiles(undefined, true)).toBe(0);
    expect(getMaxFiles({ ...slot, maxCount: 0 }, true)).toBe(0);

    const info = getFileTypeInfo(slot, t);
    expect(info.hint).toContain('supportTypes');
    expect(info.accept).toContain('.png');
    expect(info.accept).not.toContain('*');
    expect(getFileSizeHint(slot, t)).toContain('10 Bytes');
    expect(getFileSizeHint(undefined, t)).toBe('');
  });
});
