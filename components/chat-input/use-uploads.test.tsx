import { uploadDifyFile } from '@lib/services/dify/file-service';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import { syncChatDraftActor } from '@lib/stores/chat-draft-lifecycle';
import { act, renderHook } from '@testing-library/react';

import { useChatInputUploads } from './use-uploads';

jest.mock('@lib/services/dify/file-service', () => ({
  uploadDifyFile: jest.fn(),
}));
jest.mock('@lib/stores/ui/notification-store', () => ({
  useNotificationStore: { getState: () => ({ showNotification: jest.fn() }) },
}));

describe('scoped input uploads', () => {
  const t = (key: string) => key;
  const files = () =>
    [
      new File(['synthetic'], 'same.txt', { type: 'text/plain' }),
    ] as unknown as FileList;
  beforeEach(() => {
    jest.clearAllMocks();
    syncChatDraftActor('actor');
    useAttachmentStore.getState().resetAll();
    useAttachmentStore.getState().setScope('A');
  });

  it.each(['other', 'same'])(
    'rejects old file-picker and retry callbacks after %s-account relogin',
    async account => {
      const { result } = renderHook(() =>
        useChatInputUploads({
          scope: 'A',
          currentAppId: 'app-A',
          sessionUserId: 'actor',
          t,
        })
      );
      const oldSelect = result.current.handleFileSelect;
      const oldRetry = result.current.handleRetryUpload;
      act(() => {
        syncChatDraftActor(null);
        syncChatDraftActor(account === 'same' ? 'actor' : 'other');
      });
      await act(async () => {
        oldSelect(files());
        await oldRetry('old-file');
      });
      expect(useAttachmentStore.getState().getFiles('A')).toEqual([]);
      expect(uploadDifyFile).not.toHaveBeenCalled();
    }
  );

  it('does not upload or add files without a real app and user', () => {
    const { result } = renderHook(() =>
      useChatInputUploads({ scope: 'A', currentAppId: null, t })
    );
    act(() => result.current.handleFileSelect(files()));
    expect(uploadDifyFile).not.toHaveBeenCalled();
    expect(useAttachmentStore.getState().files).toEqual([]);
  });

  it('keeps a late upload on its original scope and ignores an older retry', async () => {
    const pending: Array<(value: { id: string }) => void> = [];
    jest.mocked(uploadDifyFile).mockImplementation(
      () =>
        new Promise(resolve => {
          pending.push(resolve as (value: { id: string }) => void);
        })
    );
    const { result } = renderHook(() =>
      useChatInputUploads({
        scope: 'A',
        currentAppId: 'app-A',
        sessionUserId: 'actor',
        t,
      })
    );
    act(() => result.current.handleFileSelect(files()));
    const id = useAttachmentStore.getState().files[0].id;
    act(() => {
      void result.current.handleRetryUpload(id);
    });
    act(() => useAttachmentStore.getState().setScope('B'));
    await act(async () => {
      pending[1]({ id: 'new' });
      pending[0]({ id: 'old' });
    });
    expect(useAttachmentStore.getState().files).toEqual([]);
    expect(useAttachmentStore.getState().getFiles('A')[0].uploadedId).toBe(
      'new'
    );
    expect(uploadDifyFile).toHaveBeenCalledWith(
      'app-A',
      expect.any(File),
      'actor'
    );
  });
});
