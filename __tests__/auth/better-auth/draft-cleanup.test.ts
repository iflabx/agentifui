import { ImagePreview } from '@components/file-preview/previews/image-preview';
import {
  getCurrentSession,
  signOutCurrentSession,
} from '@lib/auth/better-auth/http-client';
import { clearSessionCache } from '@lib/auth/better-auth/http-client/cache';
import { previewDifyFile } from '@lib/services/dify/file-service';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import {
  acceptedDrafts,
  appDrafts,
  pendingDrafts,
} from '@lib/stores/chat-input-scope-cache';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useLangchainDraftStore } from '@lib/stores/langchain-draft-store';
import { useFilePreviewCacheStore } from '@lib/stores/ui/file-preview-cache-store';
import { useFilePreviewStore } from '@lib/stores/ui/file-preview-store';
import { act, render } from '@testing-library/react';

import { createElement } from 'react';

jest.mock('@lib/services/dify/file-service', () => ({
  previewDifyFile: jest.fn(),
}));
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const actor = '00000000-0000-4000-8000-000000000100';
function response(userId: string | null) {
  return {
    ok: true,
    status: 200,
    json: async () => (userId ? { user: { id: userId } } : null),
  } as Response;
}
function seed() {
  useChatInputStore.getState().setActor(actor);
  useChatInputStore.getState().setMessage('Dify secret');
  useLangchainDraftStore.getState().setActor(actor);
  const scope = useLangchainDraftStore
    .getState()
    .selectScope('app-L', 'new:draft', false)!;
  useLangchainDraftStore.getState().setText(scope, 'LangChain secret');
  useAttachmentStore.getState().addFiles([new File(['secret'], 'secret.txt')]);
  return scope;
}
function expectEmpty() {
  expect(useChatInputStore.getState().message).toBe('');
  expect(useLangchainDraftStore.getState().drafts).toEqual({});
  expect(useAttachmentStore.getState().files).toEqual([]);
  expect(useAttachmentStore.getState().filesByScope).toEqual({});
  expect(useFilePreviewStore.getState().previewContent).toBeNull();
  expect(useFilePreviewCacheStore.getState().runtimeCache.size).toBe(0);
  expect(appDrafts.size + pendingDrafts.size + acceptedDrafts.size).toBe(0);
}

describe('auth-wide draft cleanup without any mounted chat', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearSessionCache();
    useChatInputStore.getState().setActor(null);
    useLangchainDraftStore.getState().setActor(null);
    useAttachmentStore.getState().resetAll();
  });

  it('clears both backends on logout and invalidates old callbacks after same-account login', async () => {
    const oldScope = seed();
    appDrafts.set('app', 'draft');
    pendingDrafts.add('draft');
    acceptedDrafts.set('external', 'draft');
    useFilePreviewCacheStore
      .getState()
      .set('app:file', new Blob(['secret']), { contentType: 'image/png' });
    useFilePreviewStore.setState({
      previewContent: new Blob(['secret']),
      isPreviewOpen: true,
    });
    const epoch = useChatInputStore.getState().actorEpoch;
    jest.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
    await signOutCurrentSession();
    expectEmpty();
    expect(useChatInputStore.getState().actorEpoch).toBeGreaterThan(epoch);
    jest.mocked(fetch).mockResolvedValueOnce(response(actor));
    await getCurrentSession({ forceRefresh: true });
    useLangchainDraftStore.getState().setText(oldScope, 'late secret');
    expectEmpty();
  });

  it('ignores a pre-logout session response and late preview content', async () => {
    seed();
    let respond!: (value: Response) => void;
    jest.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          respond = resolve;
        })
    );
    const session = getCurrentSession({ forceRefresh: true });
    let finishPreview!: (
      value: Awaited<ReturnType<typeof previewDifyFile>>
    ) => void;
    jest.mocked(previewDifyFile).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishPreview = resolve;
        })
    );
    const preview = useFilePreviewStore.getState().openPreview({
      id: 'file',
      upload_file_id: 'file',
      app_id: 'app',
      name: 'secret.png',
      size: 1,
      type: 'image/png',
    });
    jest.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true }),
    } as Response);
    await signOutCurrentSession();
    respond(response(actor));
    finishPreview({
      content: new Blob(['late secret']),
      headers: { contentType: 'image/png' },
    });
    await preview;
    await expect(session).resolves.toBeNull();
    expect(useChatInputStore.getState().actorId).toBeNull();
    expectEmpty();
  });

  it('releases mounted preview object URLs on logout outside the chat page', async () => {
    seed();
    const createDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      'createObjectURL'
    );
    const revokeDescriptor = Object.getOwnPropertyDescriptor(
      URL,
      'revokeObjectURL'
    );
    const revoke = jest.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: jest.fn(() => 'blob:secret'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revoke,
    });
    function Preview() {
      const content = useFilePreviewStore(state => state.previewContent);
      return content
        ? createElement(ImagePreview, {
            content,
            filename: 'secret.png',
            onDownload: jest.fn(),
          })
        : null;
    }
    useFilePreviewStore.setState({
      previewContent: new Blob(['secret']),
      isPreviewOpen: true,
    });
    const mounted = render(createElement(Preview));
    try {
      jest.mocked(fetch).mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);
      await act(async () => {
        await signOutCurrentSession();
      });
      expect(revoke).toHaveBeenCalledWith('blob:secret');
      expectEmpty();
    } finally {
      mounted.unmount();
      if (createDescriptor)
        Object.defineProperty(URL, 'createObjectURL', createDescriptor);
      else Reflect.deleteProperty(URL, 'createObjectURL');
      if (revokeDescriptor)
        Object.defineProperty(URL, 'revokeObjectURL', revokeDescriptor);
      else Reflect.deleteProperty(URL, 'revokeObjectURL');
    }
  });

  it.each([null, '00000000-0000-4000-8000-000000000101'])(
    'clears on a confirmed session transition to %s',
    async user => {
      seed();
      jest.mocked(fetch).mockResolvedValueOnce(response(user));
      await getCurrentSession({ forceRefresh: true });
      expectEmpty();
    }
  );

  it('preserves drafts during loading, same-user refresh, and temporary auth failure', async () => {
    seed();
    jest.mocked(fetch).mockResolvedValueOnce(response(actor));
    await getCurrentSession({ forceRefresh: true });
    expect(useChatInputStore.getState().message).toBe('Dify secret');
    jest.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await expect(getCurrentSession({ forceRefresh: true })).rejects.toThrow(
      'offline'
    );
    expect(useLangchainDraftStore.getState().drafts).not.toEqual({});
    expect(useAttachmentStore.getState().files).toHaveLength(1);
  });
});
