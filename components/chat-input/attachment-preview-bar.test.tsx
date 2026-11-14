import { uploadDifyFile } from '@lib/services/dify/file-service';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import { syncChatDraftActor } from '@lib/stores/chat-draft-lifecycle';
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
} from '@testing-library/react';

import { AttachmentPreviewBar } from './attachment-preview-bar';
import { useChatInputUploads } from './use-uploads';

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('@lib/services/dify/file-service', () => ({
  uploadDifyFile: jest.fn(),
}));
jest.mock('@components/ui/tooltip-wrapper', () => ({
  TooltipWrapper: ({ children }: { children: React.ReactNode }) => children,
}));

describe('controlled attachment leaves', () => {
  it('shows captured files/config and binds old-row retry/removal to A after selecting B', async () => {
    syncChatDraftActor('actor');
    global.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const store = useAttachmentStore.getState();
    store.resetAll();
    store.setScope('scope-A');
    store.addFiles([new File(['A'], 'A.txt')]);
    const entry = { ...store.getFiles('scope-A')[0], status: 'error' as const };
    store.setFiles([entry], 'scope-A');
    let finish!: (value: Awaited<ReturnType<typeof uploadDifyFile>>) => void;
    jest.mocked(uploadDifyFile).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const { result } = renderHook(() =>
      useChatInputUploads({
        scope: 'scope-A',
        currentAppId: 'app-A',
        sessionUserId: 'actor',
        t: key => key,
      })
    );
    render(
      <AttachmentPreviewBar
        files={[entry]}
        uploadConfig={{ enabled: true, maxFiles: 0 }}
        onHeightChange={jest.fn()}
        onRemove={id => useAttachmentStore.getState().removeFile(id, 'scope-A')}
        onRetryUpload={result.current.handleRetryUpload}
      />
    );
    store.setScope('scope-B');
    store.setFiles([{ ...entry, name: 'B.txt' }], 'scope-B');
    expect(screen.getByText('A.txt')).toBeInTheDocument();
    expect(screen.queryByText('B.txt')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(uploadDifyFile).toHaveBeenCalledWith('app-A', entry.file, 'actor');
    fireEvent.click(screen.getByRole('button', { name: 'remove' }));
    await act(async () => {
      finish({
        id: 'late-A',
        name: 'A.txt',
        size: 1,
        extension: 'txt',
        mime_type: 'text/plain',
        created_by: 'actor',
        created_at: 0,
      });
    });
    expect(store.getFiles('scope-A')).toEqual([]);
    expect(store.getFiles('scope-B')).toEqual([{ ...entry, name: 'B.txt' }]);
  });
});
