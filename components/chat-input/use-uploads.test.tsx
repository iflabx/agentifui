import { uploadDifyFile } from '@lib/services/dify/file-service';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import { syncChatDraftActor } from '@lib/stores/chat-draft-lifecycle';
import { act, renderHook } from '@testing-library/react';

import type { AgentAttachmentSlot } from '../../packages/shared/src/agent-input';
import { useChatInputUploads, validateChatAttachments } from './use-uploads';

const slot: AgentAttachmentSlot = {
  key: 'files',
  label: 'Files',
  target: 'files',
  minCount: 0,
  maxCount: 3,
  methods: ['local_file'],
  allowedTypes: ['document'],
  extensions: ['txt'],
  maxBytesByType: { document: 9 },
};

jest.mock('@lib/services/dify/file-service', () => ({
  uploadDifyFile: jest.fn(),
}));
jest.mock('@lib/stores/ui/notification-store', () => ({
  useNotificationStore: { getState: () => ({ showNotification: jest.fn() }) },
}));

describe('scoped input uploads', () => {
  it('allows omitted conversation variables only in a continuation, without relaxing native files', () => {
    const capabilities = {
      version: 1 as const,
      status: 'ready' as const,
      mode: 'conversation' as const,
      text: { enabled: true, required: true, target: 'query' },
      fields: [],
      attachmentSlots: [
        { ...slot, key: 'source', target: 'inputs' as const, minCount: 1 },
      ],
    };
    expect(validateChatAttachments(capabilities, [])).toBe(
      'INPUT_CAPABILITIES_UNSUPPORTED'
    );
    expect(validateChatAttachments(capabilities, [], true)).toBeNull();
    expect(
      validateChatAttachments(
        {
          ...capabilities,
          attachmentSlots: [
            ...capabilities.attachmentSlots,
            { ...slot, minCount: 1 },
          ],
        },
        [],
        true
      )
    ).toBe('INPUT_FILES_REQUIRED');
  });
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
          slot,
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

  it('keeps a late upload on its original scope and prevents duplicate in-flight retries', async () => {
    const pending: Array<
      (value: { id: string; preview_url?: string }) => void
    > = [];
    jest.mocked(uploadDifyFile).mockImplementation(
      () =>
        new Promise(resolve => {
          pending.push(
            resolve as (value: { id: string; preview_url?: string }) => void
          );
        })
    );
    const { result } = renderHook(() =>
      useChatInputUploads({
        scope: 'A',
        currentAppId: 'app-A',
        sessionUserId: 'actor',
        slot,
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
      pending[0]({
        id: 'new',
        preview_url: 'https://dify.example/files/new/file-preview?sign=1',
      });
    });
    expect(useAttachmentStore.getState().files).toEqual([]);
    expect(useAttachmentStore.getState().getFiles('A')[0].uploadedId).toBe(
      'new'
    );
    expect(
      useAttachmentStore.getState().getFiles('A')[0].uploadedPreviewUrl
    ).toBe('https://dify.example/files/new/file-preview?sign=1');
    expect(uploadDifyFile).toHaveBeenCalledWith(
      'app-A',
      expect.any(File),
      'actor'
    );
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
  });

  it('retries failed entries in place without reserving another slot', async () => {
    jest
      .mocked(uploadDifyFile)
      .mockRejectedValueOnce(new Error('temporary'))
      .mockResolvedValueOnce({ id: 'retry' } as never);
    const { result } = renderHook(() =>
      useChatInputUploads({
        scope: 'A',
        currentAppId: 'app-A',
        sessionUserId: 'actor',
        slot: { ...slot, maxCount: 1 },
        t,
      })
    );
    await act(async () => result.current.handleFileSelect(files()));
    const failed = useAttachmentStore.getState().files[0];
    expect(failed.status).toBe('error');
    await act(async () => result.current.handleFileSelect(files()));
    expect(useAttachmentStore.getState().files).toHaveLength(1);
    await act(async () => {
      await result.current.handleRetryUpload(failed.id);
    });
    expect(useAttachmentStore.getState().files[0]).toMatchObject({
      id: failed.id,
      status: 'success',
      uploadedId: 'retry',
    });
    expect(uploadDifyFile).toHaveBeenCalledTimes(2);
  });

  it('blocks unknown capabilities and revalidates retries after limits change', async () => {
    const { result, rerender } = renderHook(
      ({ rule }) =>
        useChatInputUploads({
          scope: 'A',
          currentAppId: 'app-A',
          sessionUserId: 'actor',
          slot: rule,
          t,
        }),
      { initialProps: { rule: undefined as AgentAttachmentSlot | undefined } }
    );
    act(() => result.current.handleFileSelect(files()));
    expect(useAttachmentStore.getState().files).toEqual([]);
    jest.mocked(uploadDifyFile).mockRejectedValueOnce(new Error('temporary'));
    rerender({ rule: slot });
    await act(async () => result.current.handleFileSelect(files()));
    const id = useAttachmentStore.getState().files[0].id;
    rerender({ rule: { ...slot, maxBytesByType: { document: 8 } } });
    await act(async () => {
      await result.current.handleRetryUpload(id);
    });
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
    expect(useAttachmentStore.getState().files).toHaveLength(1);
  });
});
