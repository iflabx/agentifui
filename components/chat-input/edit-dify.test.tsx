import { useAttachmentStore } from '@lib/stores/attachment-store';
import {
  chatInputScope,
  useChatInputStore,
} from '@lib/stores/chat-input-store';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { DifyEditProvider, useDifyEditControls } from './edit-resend';
import { ChatInput } from './index';

const mockTranslate = (key: string) => key;
jest.mock('next-intl', () => ({ useTranslations: () => mockTranslate }));
jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => ({
    session: { user: { id: 'actor' } },
    loading: false,
  }),
}));
jest.mock('@lib/hooks/use-current-app', () => ({
  useCurrentApp: () => ({ currentAppId: 'app', isValidatingForMessage: false }),
}));
jest.mock('@lib/hooks/use-chat-width', () => ({
  useChatWidth: () => ({ widthClass: 'max-w-3xl' }),
}));
jest.mock('@lib/hooks/use-chat-input-app', () => ({
  useChatInputApp: () => ({ instance: null, failed: false }),
}));
jest.mock('@lib/hooks/use-file-types', () => ({
  useFileTypes: () => ({ uploadConfig: {} }),
}));
jest.mock('@lib/hooks/use-chat-input-route-sync', () => ({
  registerChatInputSubmission: () => () => undefined,
  useChatInputRouteSync: () => ({ ready: true, appId: 'app' }),
}));
jest.mock('./use-uploads', () => ({ useChatInputUploads: () => ({}) }));
jest.mock('./model-selector-button', () => ({
  ModelSelectorButton: () => null,
}));
jest.mock('./file-type-selector', () => ({ FileTypeSelector: () => null }));
jest.mock('./attachment-preview-bar', () => ({
  AttachmentPreviewBar: () => null,
}));
jest.mock('@components/ui/confirm-dialog', () => ({
  ConfirmDialog: ({
    onConfirm,
    onClose,
  }: {
    onConfirm: () => void;
    onClose: () => void;
  }) => (
    <div role="dialog">
      <button onClick={onConfirm}>confirm</button>
      <button onClick={onClose}>cancel</button>
    </div>
  ),
}));

function EditMessage() {
  const edit = useDifyEditControls();
  return edit ? (
    <button
      disabled={edit.disabled}
      onClick={() =>
        edit.start({ id: 'old', text: 'old question', hasAttachments: true })
      }
    >
      edit
    </button>
  ) : null;
}
function Harness({ submit }: { submit: () => Promise<unknown> }) {
  return (
    <DifyEditProvider>
      <EditMessage />
      <ChatInput
        onSubmit={submit}
        showModelSelector={false}
        requireModelValidation={false}
      />
    </DifyEditProvider>
  );
}
function activate(target: string) {
  const scope = chatInputScope(
    useChatInputStore.getState().actorEpoch,
    'actor',
    'app',
    target
  );
  useChatInputStore.getState().setCurrentRoute(scope);
  useAttachmentStore.getState().setScope(scope);
  return scope;
}

describe('Dify edit preparation through the existing composer', () => {
  beforeEach(() => {
    useChatInputStore.getState().setActor(null);
    useChatInputStore.getState().setActor('actor');
    useAttachmentStore.getState().resetAll();
    activate('conversation:original');
  });

  it('requires a persisted conversation scope', () => {
    activate('newdraft:original');
    render(<Harness submit={jest.fn()} />);
    expect(screen.queryByText('edit')).not.toBeInTheDocument();
  });

  it('cancels intact, clears only selected attachments on confirm, and ignores late upload completion', () => {
    const store = useAttachmentStore.getState();
    store.addFiles([new File(['data'], 'draft.txt')]);
    const file = useAttachmentStore.getState().files[0];
    const scope = useChatInputStore.getState().currentRoute;
    const attempt = store.beginUpload(scope, file.id)!;
    useChatInputStore.getState().setMessage('current draft');
    const submit = jest.fn();
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    fireEvent.click(screen.getByText('cancel'));
    expect(useChatInputStore.getState().message).toBe('current draft');
    expect(useAttachmentStore.getState().files).toHaveLength(1);
    fireEvent.click(screen.getByText('edit'));
    fireEvent.click(screen.getByText('confirm'));
    act(() =>
      store.finishUpload(scope, file.id, attempt, { uploadedId: 'late' })
    );
    expect(useAttachmentStore.getState().files).toEqual([]);
    expect(useChatInputStore.getState().message).toContain('old question');
    expect(useChatInputStore.getState().currentRoute).toBe(scope);
    expect(submit).not.toHaveBeenCalled();
  });

  it('uses the normal submit payload, preserves an unaccepted draft, and consumes only explicit acceptance', async () => {
    const submit = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ok: true });
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'visible new requirement' },
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'input.sendMessage' })
      );
    });
    expect(submit).toHaveBeenLastCalledWith(
      'visible new requirement',
      undefined,
      'old'
    );
    expect(useChatInputStore.getState().message).toBe(
      'visible new requirement'
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole('button', { name: 'input.sendMessage' })
      );
    });
    expect(useChatInputStore.getState().message).toBe('');
  });

  it('blocks replacement while submission is pending and preserves newer draft content', async () => {
    let finish!: (value: unknown) => void;
    const submit = jest.fn(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    fireEvent.click(screen.getByRole('button', { name: 'input.sendMessage' }));
    expect(screen.getByText('edit')).toBeDisabled();
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'later draft' },
    });
    await act(async () => {
      finish({ ok: true });
    });
    expect(useChatInputStore.getState().message).toBe('later draft');
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('drops an open confirmation when changing conversation', () => {
    useChatInputStore.getState().setMessage('A draft');
    render(<Harness submit={jest.fn()} />);
    fireEvent.click(screen.getByText('edit'));
    act(() => {
      activate('conversation:B');
      useChatInputStore.getState().setMessage('B draft');
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('B draft');
  });
});
