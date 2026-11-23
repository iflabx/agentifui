import { uploadDifyFile } from '@lib/services/dify/file-service';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import type { AgentInputCapabilities } from '../../packages/shared/src/agent-input';
import { ChatInput } from './index';
import type { ChatInputViewProps } from './view';

const mockRetry = jest.fn();
const ready: AgentInputCapabilities = {
  version: 1,
  status: 'ready',
  mode: 'conversation',
  text: { enabled: true, required: true, target: 'query' },
  fields: [],
  attachmentSlots: [],
};
let mockCapabilities: AgentInputCapabilities | null = ready;
let mockError: string | null = null;
let mockAuthLoading = false;
let mockRealPicker = false;
let mockView: ChatInputViewProps;
jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => ({
    session: { user: { id: 'actor' } },
    loading: mockAuthLoading,
  }),
}));
jest.mock('@lib/hooks/use-current-app', () => ({
  useCurrentApp: () => ({ currentAppId: 'app', isValidatingForMessage: false }),
}));
jest.mock('@lib/hooks/use-chat-input-app', () => ({
  useChatInputApp: () => ({
    instance: {
      id: 'uuid',
      instance_id: 'app',
      display_name: 'App name',
      description: 'App description',
    },
    failed: false,
  }),
}));
jest.mock('@lib/hooks/use-chat-input-route-sync', () => ({
  useChatInputRouteSync: () => ({
    ready: !mockAuthLoading,
    appId: mockAuthLoading ? null : 'app',
  }),
  registerChatInputSubmission: () => () => {},
}));
jest.mock('@lib/hooks/use-chat-width', () => ({
  useChatWidth: () => ({ widthClass: '' }),
}));
jest.mock('@lib/hooks/use-file-types', () => ({
  useFileTypes: () => ({
    capabilities: mockCapabilities,
    slot: mockCapabilities?.attachmentSlots.find(
      slot => slot.target === 'files'
    ),
    isLoading: !mockCapabilities && !mockError,
    error: mockError,
    retry: mockRetry,
    fileTypes: mockRealPicker
      ? [
          {
            title: 'document',
            acceptString: '.txt',
            extensions: ['txt'],
            icon: null,
            maxSize: '100 B',
          },
        ]
      : [],
    uploadConfig: {
      enabled: mockRealPicker,
      maxFiles: mockRealPicker ? 2 : 0,
      supportedMethods: [],
      hasFileTypes: false,
      allowedExtensions: [],
    },
  }),
}));
jest.mock('@lib/stores/app-list-store', () => ({
  useAppListStore: (selector: (state: { apps: unknown[] }) => unknown) =>
    selector({ apps: [] }),
}));
jest.mock('@lib/stores/chat-store', () => ({
  useChatStore: (selector: (state: { messages: unknown[] }) => unknown) =>
    selector({ messages: [] }),
}));
jest.mock('./edit-resend', () => ({
  useEditResend: () => ({ active: false }),
  useRegisterDifyEdit: () => {},
}));
jest.mock('./model-selector-button', () => ({
  ModelSelectorButton: () => null,
}));
jest.mock('./file-type-selector', () => ({
  FileTypeSelector: (
    props: Parameters<typeof import('./file-type-selector').FileTypeSelector>[0]
  ) => {
    const Actual = jest.requireActual('./file-type-selector').FileTypeSelector;
    return mockRealPicker ? <Actual {...props} /> : null;
  },
}));
jest.mock('@lib/services/dify/file-service', () => ({
  uploadDifyFile: jest.fn(),
}));
jest.mock('./attachment-preview-bar', () => ({
  AttachmentPreviewBar: () => null,
}));
jest.mock('./button', () => ({
  ChatButton: ({
    onClick,
    ariaLabel,
    disabled,
  }: {
    onClick: () => void;
    ariaLabel: string;
    disabled?: boolean;
  }) => (
    <button disabled={disabled} onClick={onClick}>
      {ariaLabel}
    </button>
  ),
}));
jest.mock('./view', () => ({
  ChatInputView: (props: ChatInputViewProps) => {
    mockView = props;
    return (
      <>
        {props.beforeInput}
        <textarea
          value={props.value}
          onChange={event => props.onValueChange(event.target.value)}
        />
        <button
          disabled={props.disabled || props.isWaiting}
          onClick={props.onSubmit}
        >
          Send
        </button>
        {props.editNotice}
        {props.attachmentAction}
      </>
    );
  },
}));

describe('composer capability gate', () => {
  it('refreshes capabilities on native non-INPUT refusal without resubmitting or consuming the draft', async () => {
    mockCapabilities = ready;
    mockError = null;
    mockAuthLoading = false;
    mockRealPicker = false;
    const onSubmit = jest.fn().mockResolvedValue({
      ok: false,
      surfaced: true,
      errorCode: 'invalid_param',
    });
    render(<ChatInput onSubmit={onSubmit} showModelSelector={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(mockRetry).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox')).toHaveValue('saved draft');
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockCapabilities = ready;
    mockError = null;
    useChatInputStore.getState().setActor('actor');
    useChatInputStore.getState().clearAllMessages();
    useChatInputStore.getState().setCurrentRoute('default');
    useChatInputStore.getState().setMessage('saved draft');
    useAttachmentStore.getState().resetAll();
  });
  it.each(['same', 'replacement'])(
    'retains file selection across %s session refresh without crossing actor epochs',
    async session => {
      mockRealPicker = true;
      mockCapabilities = {
        ...ready,
        attachmentSlots: [
          {
            key: 'files',
            label: 'Documents',
            target: 'files',
            minCount: 0,
            maxCount: 2,
            methods: ['local_file'],
            allowedTypes: ['document'],
            extensions: ['txt'],
            maxBytesByType: { document: 100 },
          },
        ],
      };
      jest
        .mocked(uploadDifyFile)
        .mockResolvedValue({ id: 'uploaded' } as never);
      const props = { onSubmit: jest.fn(), showModelSelector: false };
      const click = jest
        .spyOn(HTMLInputElement.prototype, 'click')
        .mockImplementation(() => undefined);
      const view = render(<ChatInput {...props} />);
      fireEvent.click(
        screen.getByRole('button', { name: /input.addAttachment$/ })
      );
      expect(click).toHaveBeenCalledTimes(1);
      const input = click.mock.contexts[0] as HTMLInputElement;
      mockAuthLoading = true;
      view.rerender(<ChatInput {...props} />);
      expect(
        screen.queryByRole('button', { name: /input.addAttachment$/ })
      ).not.toBeInTheDocument();
      if (session === 'replacement') {
        act(() => {
          useChatInputStore.getState().setActor(null);
          useChatInputStore.getState().setActor('actor');
        });
      }
      mockAuthLoading = false;
      view.rerender(<ChatInput {...props} />);
      fireEvent.change(input, {
        target: { files: [new File(['note'], 'note.txt')] },
      });
      if (session === 'same') {
        await waitFor(() =>
          expect(uploadDifyFile).toHaveBeenCalledWith(
            'app',
            expect.any(File),
            'actor'
          )
        );
        await waitFor(() =>
          expect(useAttachmentStore.getState().files[0].status).toBe('success')
        );
        expect(uploadDifyFile).toHaveBeenCalledTimes(1);
      } else {
        expect(uploadDifyFile).not.toHaveBeenCalled();
        expect(useAttachmentStore.getState().files).toEqual([]);
      }
      click.mockRestore();
    }
  );
  it('uses the shared introduction and quiet input until native acceptance, not an optimistic send', async () => {
    const onSubmit = jest.fn().mockResolvedValue({ ok: false, surfaced: true });
    render(<ChatInput onSubmit={onSubmit} showModelSelector={false} />);
    expect(screen.getByText('App name')).toBeInTheDocument();
    expect(screen.getByText('App description')).toBeInTheDocument();
    expect(mockView.placeholder).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(screen.getByText('App description')).toBeInTheDocument();
    act(() => useChatInputStore.getState().markAccepted('default'));
    expect(screen.queryByText('App description')).not.toBeInTheDocument();
    act(() =>
      useChatInputStore
        .getState()
        .setCurrentRoute(JSON.stringify([0, 'actor', 'app', 'new:another']))
    );
    expect(screen.getByText('App description')).toBeInTheDocument();
  });
  it.each(['loading', 'unavailable', 'unsupported', 'failed'] as const)(
    'blocks %s, preserves drafts and offers retry for failures',
    async state => {
      mockCapabilities =
        state === 'loading' || state === 'failed'
          ? null
          : { ...ready, status: state };
      mockError = state === 'failed' ? 'unavailable' : null;
      const onSubmit = jest
        .fn()
        .mockResolvedValue({ ok: false, surfaced: true });
      const view = render(
        <ChatInput onSubmit={onSubmit} showModelSelector={false} />
      );
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
      await act(async () => {
        await mockView.onSubmit();
      });
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole('textbox')).toHaveValue('saved draft');
      if (state !== 'loading') {
        fireEvent.click(screen.getByRole('button', { name: /ui.retry/ }));
        expect(mockRetry).toHaveBeenCalledTimes(1);
      }
      mockCapabilities = ready;
      mockError = null;
      view.rerender(
        <ChatInput onSubmit={onSubmit} showModelSelector={false} />
      );
      expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'Send' }));
      await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    }
  );
  it('revalidates required counts and existing files when live limits change, without deleting them', () => {
    mockCapabilities = {
      ...ready,
      attachmentSlots: [
        {
          key: 'files',
          label: 'Files',
          target: 'files',
          minCount: 1,
          maxCount: 1,
          methods: ['local_file'],
          allowedTypes: ['document'],
          extensions: ['txt'],
          maxBytesByType: { document: 3 },
        },
      ],
    };
    const view = render(
      <ChatInput onSubmit={jest.fn()} showModelSelector={false} />
    );
    expect(
      screen.getByText('pages.chat.input.filesRequired')
    ).toBeInTheDocument();
    act(() => {
      useAttachmentStore.getState().addFiles([new File(['123'], 'a.txt')]);
      const id = useAttachmentStore.getState().files[0].id;
      useAttachmentStore.getState().updateFileUploadedId(id, 'uploaded');
    });
    expect(screen.getByRole('button', { name: 'Send' })).not.toBeDisabled();
    mockCapabilities = {
      ...mockCapabilities,
      attachmentSlots: [
        {
          ...mockCapabilities.attachmentSlots[0],
          maxBytesByType: { document: 2 },
        },
      ],
    };
    view.rerender(<ChatInput onSubmit={jest.fn()} showModelSelector={false} />);
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(
      screen.getByText('pages.chat.fileUpload.fileTooLarge')
    ).toBeInTheDocument();
    expect(useAttachmentStore.getState().files).toHaveLength(1);
  });
});
