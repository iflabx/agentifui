/** @jest-environment node */
import {
  buildSubmitFiles,
  getChatInputAriaLabel,
  getDifyFileType,
  shouldBlockEnterSubmit,
} from '@components/chat-input/helpers';

const t = (key: string) => key;

describe('chat input helpers', () => {
  it('maps file types for dify uploads', () => {
    expect(getDifyFileType({ type: 'image/png' } as never)).toBe('image');
    expect(getDifyFileType({ type: 'audio/mpeg' } as never)).toBe('audio');
    expect(getDifyFileType({ type: 'video/mp4' } as never)).toBe('video');
    expect(getDifyFileType({ type: 'application/pdf' } as never)).toBe(
      'document'
    );
    expect(getDifyFileType({ type: 'application/octet-stream' } as never)).toBe(
      'custom'
    );
  });

  it('builds submit files from successful uploaded attachments', () => {
    expect(
      buildSubmitFiles([
        {
          name: 'demo.pdf',
          size: 12,
          type: 'application/pdf',
          status: 'success',
          uploadedId: 'upload-1',
        },
        {
          name: 'skip.txt',
          size: 2,
          type: 'text/plain',
          status: 'uploading',
        },
      ] as never)
    ).toEqual([
      {
        type: 'document',
        transfer_method: 'local_file',
        upload_file_id: 'upload-1',
        name: 'demo.pdf',
        size: 12,
        mime_type: 'application/pdf',
      },
    ]);
    expect(buildSubmitFiles([] as never)).toBeUndefined();
  });

  it('blocks enter submit for invalid states and builds aria labels', () => {
    expect(
      shouldBlockEnterSubmit({
        attachments: [],
        canSubmitWithModel: true,
        isComposing: true,
        isLocalSubmitting: false,
        isProcessing: false,
        isValidatingAppConfig: false,
        isWaiting: false,
        message: 'hello',
      })
    ).toBe(true);
    expect(
      shouldBlockEnterSubmit({
        attachments: [],
        canSubmitWithModel: true,
        isComposing: false,
        isLocalSubmitting: false,
        isProcessing: false,
        isValidatingAppConfig: false,
        isWaiting: false,
        message: 'hello',
      })
    ).toBe(false);

    expect(
      getChatInputAriaLabel({
        canSubmitWithModel: false,
        hasAvailableModels: false,
        hasError: false,
        isLocalSubmitting: false,
        isProcessing: false,
        isUploading: false,
        isValidatingConfig: false,
        isWaiting: false,
        requireModelValidation: true,
        t,
      })
    ).toBe('input.noModelAvailable');
  });
});
