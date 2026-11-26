import { getCurrentSession } from '@lib/auth/better-auth/http-client';
import { uploadDifyFile } from '@lib/services/dify/file-service';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { act, fireEvent, render, waitFor } from '@testing-library/react';

import { StrictMode } from 'react';

import type { AgentAttachmentSlot } from '../../../packages/shared/src/agent-input';
import { FileUploadField } from './file-upload-field';

const slot: AgentAttachmentSlot = {
  key: 'docs',
  label: 'Docs',
  target: 'inputs',
  minCount: 1,
  maxCount: 1,
  methods: ['local_file'],
  allowedTypes: ['document'],
  extensions: ['txt'],
  maxBytesByType: { document: 100 },
};

jest.mock('@lib/auth/better-auth/http-client', () => ({
  getCurrentSession: jest.fn(),
  subscribeAuthStateChange: jest.requireActual(
    '@lib/auth/better-auth/http-client/cache'
  ).subscribeAuthStateChange,
}));
jest.mock('@lib/services/dify/file-service', () => ({
  uploadDifyFile: jest.fn(),
}));

describe('file picker focus authentication refresh', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useChatInputStore.getState().setActor(null);
    useChatInputStore.getState().setActor('actor');
    jest
      .mocked(getCurrentSession)
      .mockResolvedValue({ user: { id: 'actor' } } as never);
    jest.mocked(uploadDifyFile).mockResolvedValue({ id: 'uploaded' } as never);
  });

  it('retains the selected file across focus and a delayed session response, without duplicate uploads', async () => {
    const onChange = jest.fn();
    const view = render(
      <StrictMode>
        <FileUploadField
          slot={slot}
          config={{}}
          instanceId="app"
          value={null}
          onChange={onChange}
          isSingleFileMode
        />
      </StrictMode>
    );
    await waitFor(() =>
      expect(
        view.container.querySelector('input[type="file"]')
      ).not.toBeDisabled()
    );
    let finishRefresh!: (value: never) => void;
    jest.mocked(getCurrentSession).mockImplementation(
      () =>
        new Promise(resolve => {
          finishRefresh = resolve;
        })
    );
    const fileInput = view.container.querySelector('input[type="file"]')!;
    const picker = jest.spyOn(fileInput as HTMLInputElement, 'click');
    fireEvent.click(view.getByText('pages.workflow.fileUpload.dropOrClick'));
    expect(picker).toHaveBeenCalledTimes(1);
    fireEvent.focus(window);
    fireEvent.change(fileInput, {
      target: {
        files: [
          new File(['Synthetic upload'], 'focus.txt', { type: 'text/plain' }),
        ],
      },
    });
    expect(view.getByText('focus.txt')).toBeInTheDocument();
    expect(uploadDifyFile).not.toHaveBeenCalled();
    await act(async () => {
      finishRefresh({ user: { id: 'actor' } } as never);
    });
    await waitFor(() => expect(uploadDifyFile).toHaveBeenCalledTimes(1));
    expect(uploadDifyFile).toHaveBeenCalledWith(
      'app',
      expect.any(File),
      'actor'
    );
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ upload_file_id: 'uploaded', actor_id: 'actor' })
    );
  });
});
