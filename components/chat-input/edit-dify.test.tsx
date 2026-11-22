import { useAttachmentStore } from '@lib/stores/attachment-store';
import {
  chatInputScope,
  useChatInputStore,
} from '@lib/stores/chat-input-store';
import { useChatStore } from '@lib/stores/chat-store';
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
  useChatInputApp: () => ({ instance: { id: 'app' }, failed: false }),
}));
jest.mock('@lib/hooks/use-file-types', () => ({
  useFileTypes: () => ({
    uploadConfig: {},
    capabilities: {
      version: 1,
      status: 'ready',
      mode: 'conversation',
      text: { enabled: true, required: true, target: 'query' },
      fields: [],
      attachmentSlots: [],
    },
  }),
}));
jest.mock('@lib/hooks/use-chat-input-route-sync', () => ({
  registerChatInputSubmission: () => () => undefined,
  useChatInputRouteSync: () => ({ ready: true, appId: 'app' }),
}));
jest.mock('./use-uploads', () => ({
  ...jest.requireActual('./use-uploads'),
  useChatInputUploads: () => ({}),
}));
jest.mock('./model-selector-button', () => ({
  ModelSelectorButton: () => null,
}));
jest.mock('./file-type-selector', () => ({ FileTypeSelector: () => null }));
jest.mock('./attachment-preview-bar', () => ({
  AttachmentPreviewBar: () => null,
}));

function EditMessage() {
  const edit = useDifyEditControls();
  return edit ? (
    <article data-testid="old-message">
      {edit.editor || (
        <button
          disabled={edit.disabled}
          onClick={() =>
            edit.start({
              id: 'old',
              text: 'old question',
              hasAttachments: true,
            })
          }
        >
          edit
        </button>
      )}
    </article>
  ) : null;
}
function Harness({
  submit,
}: {
  submit: (...args: unknown[]) => Promise<unknown>;
}) {
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

describe('Dify inline editing without replacing the composer', () => {
  beforeEach(() => {
    useChatInputStore.getState().setActor(null);
    useChatInputStore.getState().setActor('actor');
    useAttachmentStore.getState().resetAll();
    useChatStore.setState({
      messages: [{ id: 'old', text: 'old question', isUser: true }],
    });
    activate('conversation:original');
  });
  it('requires a persisted conversation scope', () => {
    activate('newdraft:original');
    render(<Harness submit={jest.fn()} />);
    expect(screen.queryByText('edit')).not.toBeInTheDocument();
  });
  it('keeps bottom text and attachments on cancel, rejection and acceptance', async () => {
    useAttachmentStore.getState().addFiles([new File(['data'], 'draft.txt')]);
    const files = useAttachmentStore.getState().files;
    useChatInputStore.getState().setMessage('bottom draft');
    const submit = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, surfaced: true })
      .mockResolvedValueOnce({ ok: true });
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    const bottom = document.querySelector('textarea[name="message"]')!;
    expect(bottom).toHaveValue('bottom draft');
    expect(bottom).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(bottom).toBeEnabled();
    fireEvent.click(screen.getByText('edit'));
    const editor = screen.getByRole('textbox', { name: 'editorLabel' });
    fireEvent.change(editor, { target: { value: 'revised question' } });
    fireEvent.keyDown(bottom, { key: 'Enter' });
    expect(submit).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'send' }));
    });
    expect(submit).toHaveBeenLastCalledWith(
      'revised question',
      undefined,
      'old'
    );
    expect(editor).toHaveValue('revised question');
    expect(useChatInputStore.getState().message).toBe('bottom draft');
    expect(useAttachmentStore.getState().files).toBe(files);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'send' }));
    });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(useChatInputStore.getState().message).toBe('bottom draft');
    expect(useAttachmentStore.getState().files).toBe(files);
  });
  it('resolves a source that completed saving after opening the editor', async () => {
    const submit = jest.fn().mockResolvedValue({ ok: true });
    render(<Harness submit={submit} />);
    fireEvent.click(screen.getByText('edit'));
    act(() =>
      useChatStore.setState({
        messages: [
          {
            id: 'old',
            db_id: 'saved-source-id',
            text: 'old question',
            isUser: true,
          },
        ],
      })
    );
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'send' }));
    });
    expect(submit).toHaveBeenCalledWith(
      'old question',
      undefined,
      'saved-source-id'
    );
  });
  it('closes on navigation without changing the new conversation draft', () => {
    render(<Harness submit={jest.fn()} />);
    fireEvent.click(screen.getByText('edit'));
    act(() => {
      activate('conversation:B');
      useChatInputStore.getState().setMessage('B draft');
    });
    expect(screen.queryByRole('form')).not.toBeInTheDocument();
    expect(document.querySelector('textarea[name="message"]')).toHaveValue(
      'B draft'
    );
  });
});
