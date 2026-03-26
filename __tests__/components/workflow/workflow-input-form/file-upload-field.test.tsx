import { FileUploadField } from '@components/workflow/workflow-input-form/file-upload-field';
import { uploadDifyFile } from '@lib/services/dify/file-service';
import { fireEvent, render, waitFor } from '@testing-library/react';

import { act } from 'react';

jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => ({
    session: {
      user: {
        id: 'user-1',
      },
    },
  }),
}));

jest.mock('@lib/hooks/use-current-app', () => ({
  useCurrentApp: () => ({
    currentAppId: 'app-1',
  }),
}));

jest.mock('@lib/services/dify/file-service', () => ({
  uploadDifyFile: jest.fn(),
}));

describe('FileUploadField', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (uploadDifyFile as jest.Mock).mockResolvedValue({
      id: 'uploaded-1',
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('syncs uploaded file payload back to the parent after upload success', async () => {
    const onChange = jest.fn();

    const { container } = render(
      <FileUploadField
        config={{
          enabled: true,
          max_length: 1,
          allowed_file_types: ['document'],
        }}
        value={null}
        onChange={onChange}
        instanceId="workflow-app-1"
        isSingleFileMode={true}
      />
    );

    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    const file = new File(['hello workflow'], 'demo.txt', {
      type: 'text/plain',
    });

    await act(async () => {
      fireEvent.change(input as HTMLInputElement, {
        target: { files: [file] },
      });
      jest.advanceTimersByTime(100);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(uploadDifyFile).toHaveBeenCalledWith(
        'app-1',
        expect.any(File),
        'user-1'
      );
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith({
        type: 'document',
        transfer_method: 'local_file',
        upload_file_id: 'uploaded-1',
        name: 'demo.txt',
        size: file.size,
        mime_type: 'text/plain',
      });
    });
  });
});
