import { AgentRequestError } from '@lib/services/client/langchain-api';
import { syncChatDraftActor } from '@lib/stores/chat-draft-lifecycle';
import { useLangchainDraftStore } from '@lib/stores/langchain-draft-store';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { TextEncoder } from 'node:util';

import { useEffect } from 'react';

import { AGUI_TOOL_SUMMARY } from '../../packages/shared/src/agui';
import { AgentChat } from './agent-chat';
import { restoreAgentView } from './agui-state';
import { useAgentChat } from './use-agent-chat';
import { useAgentInteractions } from './use-agent-interactions';

let mockActorId: string | null = 'user';
let mockAuthLoading = false;
jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => ({
    session: mockActorId ? { user: { id: mockActorId } } : null,
    loading: mockAuthLoading,
  }),
}));
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('react-markdown', () => ({ __esModule: true, default: () => null }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));
jest.mock('./use-agent-chat', () => ({
  ...jest.requireActual('./use-agent-chat'),
  useAgentChat: jest.fn(),
}));
jest.mock('./use-agent-interactions', () => ({
  useAgentInteractions: jest.fn(),
}));
jest.mock('@lib/hooks/use-combined-conversations', () => ({
  conversationEvents: { emit: jest.fn() },
}));
jest.mock('@lib/hooks/use-chat-width', () => ({
  useChatWidth: () => ({ widthClass: 'max-w-3xl', paddingClass: 'px-4' }),
}));
jest.mock('@components/chat/chat-input-backdrop', () => ({
  ChatInputBackdrop: () => null,
}));
jest.mock('@components/file-preview/file-preview-canvas', () => ({
  FilePreviewCanvas: () => null,
}));
jest.mock('@components/chat-input/view', () => ({
  ChatInputView: ({
    value,
    onValueChange,
    onSubmit,
    disabled,
    beforeInput,
    attachmentAction,
    placeholder,
  }: {
    value: string;
    onValueChange: (text: string) => void;
    onSubmit: () => void;
    disabled?: boolean;
    beforeInput?: React.ReactNode;
    attachmentAction?: React.ReactNode;
    placeholder?: string;
  }) => (
    <form
      data-testid="shared-input"
      onSubmit={event => {
        event.preventDefault();
        onSubmit();
      }}
    >
      {beforeInput}
      {attachmentAction}
      <textarea
        placeholder={placeholder}
        value={value}
        onChange={event => onValueChange(event.target.value)}
        disabled={disabled}
      />
      <button type="submit" disabled={disabled}>
        send
      </button>
    </form>
  ),
}));
jest.mock('@components/chat/messages/user-message/user-message', () => ({
  UserMessage: ({
    id,
    content,
    onEdit,
    editDisabled,
    editor,
  }: {
    id: string;
    content: string;
    onEdit?: () => void;
    editDisabled?: boolean;
    editor?: React.ReactNode;
  }) => (
    <div data-testid="shared-user" data-message-id={id}>
      {editor ?? content}
      {!editor && onEdit && (
        <button disabled={editDisabled} onClick={onEdit}>
          edit-{id}
        </button>
      )}
    </div>
  ),
}));
jest.mock(
  '@components/chat/messages/assistant-message/assistant-message',
  () => ({
    AssistantMessage: ({ id, content }: { id: string; content: string }) => (
      <div data-testid="shared-assistant" data-message-id={id}>
        {content}
      </div>
    ),
  })
);

describe('Agent chat draft', () => {
  const send = jest.fn();
  const originalFetch = global.fetch;
  const originalTextEncoder = globalThis.TextEncoder;

  beforeAll(() => {
    globalThis.TextEncoder = TextEncoder;
  });

  afterAll(() => {
    globalThis.TextEncoder = originalTextEncoder;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    syncChatDraftActor(null);
    mockActorId = 'user';
    mockAuthLoading = false;
    jest.mocked(useAgentInteractions).mockReturnValue({
      scope: 'test',
      items: [],
      loading: false,
      error: false,
      exhausted: false,
      blocked: false,
      respond: jest.fn().mockResolvedValue(undefined),
      check: jest.fn(),
    });
    jest.mocked(useAgentChat).mockReturnValue({
      editRecovery: null,
      pendingEdit: undefined,
      view: { messages: [], tools: [] },
      draftScope: 'new:0',
      appName: 'Agent',
      appDescription: 'Agent description',
      textOnly: false,
      acceptsInputCapabilities: false,
      humanInput: false,
      singleTask: false,
      resultSingleBatch: false,
      refresh: jest.fn(),
      newConversationsEnabled: true,
      nextCursor: null,
      loadingMore: false,
      loadMore: jest.fn(),
      ready: true,
      busy: false,
      error: null,
      unconfirmed: false,
      statusCheckExhausted: false,
      retryStatus: jest.fn(),
      historyLoading: false,
      historyFailed: false,
      send,
      select: jest.fn(),
      remove: jest.fn(),
      newConversation: jest.fn(),
    });
  });

  it('reserves space for fixed desktop and mobile shell navigation', () => {
    const view = render(<AgentChat appId="app" conversationId={null} />);
    const composer = view.container.querySelector('[data-app-chat-composer]');
    expect(composer).toHaveAttribute('data-app-chat-composer', 'welcome');
    expect(composer?.parentElement).toHaveClass('pt-12', 'md:pt-10');
  });

  it('shares the configured introduction and quiet composer without promising unsupported uploads', () => {
    const base = useAgentChat('app', null, 'user');
    const view = render(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByText('Agent description')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', '');
    expect(
      screen.getByRole('button', { name: 'fileTypeSelector.ariaLabel' })
    ).toBeDisabled();
    jest.mocked(useAgentChat).mockReturnValue({
      ...base,
      busy: true,
      view: {
        ...base.view,
        messages: [{ id: 'optimistic', role: 'user', content: 'Request' }],
      },
    });
    view.rerender(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByText('Agent description')).toBeInTheDocument();
    jest.mocked(useAgentChat).mockReturnValue({
      ...base,
      view: { ...base.view, conversationId: 'accepted' },
    });
    view.rerender(<AgentChat appId="app" conversationId={null} />);
    expect(screen.queryByText('Agent description')).not.toBeInTheDocument();
    jest.mocked(useAgentChat).mockReturnValue(base);
    view.rerender(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByText('Agent description')).toBeInTheDocument();
  });

  it('refreshes changed input requirements and preserves the text draft', async () => {
    const base = useAgentChat('app', null, 'user');
    jest.mocked(useAgentChat).mockReturnValue({
      ...base,
      acceptsInputCapabilities: true,
    });
    const capabilities = (label: string) => ({
      version: 1,
      status: 'ready',
      text: { enabled: true, required: true, target: 'query' },
      fields: [{ key: 'topic', label, type: 'text-input', required: true }],
      attachmentSlots: [],
    });
    let label = 'Original topic';
    syncChatDraftActor('user');
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () =>
          ({ ok: true, json: async () => capabilities(label) }) as Response
      );
    try {
      const view = render(<AgentChat appId="app" conversationId={null} />);
      await screen.findByLabelText('Original topic');
      const input = screen.getByRole('textbox', { name: '' });
      fireEvent.change(input, { target: { value: 'Keep this question' } });
      const initialCalls = fetchMock.mock.calls.length;
      label = 'Updated topic';
      jest.mocked(useAgentChat).mockReturnValue({
        ...base,
        acceptsInputCapabilities: true,
        error: new AgentRequestError(400, {
          code: 'INPUT_FIELD_INVALID',
          userMessage: 'Requirements changed',
          source: 'frontend',
          severity: 'warn',
          retryable: false,
          requestId: '',
          occurredAt: '2026-01-01T00:00:00.000Z',
        }),
      });
      view.rerender(<AgentChat appId="app" conversationId={null} />);
      await screen.findByLabelText('Updated topic');
      expect(fetchMock).toHaveBeenCalledTimes(initialCalls + 1);
      expect(input).toHaveValue('Keep this question');
      expect(send).not.toHaveBeenCalled();
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('edits in the original message and preserves the bottom draft on rejection and acceptance', async () => {
    const base = useAgentChat('app', null, 'user');
    const messages = [
      { id: 'old', role: 'user' as const, content: 'old request' },
      { id: 'reply', role: 'assistant' as const, content: 'old answer' },
    ];
    jest.mocked(useAgentChat).mockReturnValue({
      ...base,
      draftScope: 'thread',
      view: { ...base.view, conversationId: 'thread', messages },
    });
    render(<AgentChat appId="app" conversationId="thread" />);
    const bottom = within(screen.getByTestId('shared-input'));
    const input = bottom.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Unsent bottom draft' } });
    const drafts = useLangchainDraftStore.getState().drafts;
    fireEvent.click(screen.getByText('edit-old'));
    expect(send).not.toHaveBeenCalled();
    const message = within(screen.getByTestId('shared-user'));
    const editor = message.getByRole('textbox');
    expect(editor).toHaveValue('old request');
    expect(input).toHaveValue('Unsent bottom draft');
    expect(input).toBeDisabled();
    expect(bottom.getByRole('button', { name: 'send' })).toBeDisabled();
    fireEvent.change(editor, { target: { value: 'my visible correction' } });
    fireEvent.submit(screen.getByTestId('shared-input'));
    expect(send).not.toHaveBeenCalled();
    send.mockResolvedValueOnce(false);
    await act(async () => {
      fireEvent.click(message.getByRole('button', { name: 'send' }));
    });
    expect(send).toHaveBeenLastCalledWith(
      'my visible correction',
      undefined,
      'old'
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(message.getByRole('textbox')).toHaveValue('my visible correction');
    expect(input).toHaveValue('Unsent bottom draft');
    expect(useLangchainDraftStore.getState().drafts).toBe(drafts);
    expect(screen.getByTestId('shared-assistant')).toHaveTextContent(
      'old answer'
    );
    send.mockResolvedValueOnce(true);
    await act(async () => {
      fireEvent.click(message.getByRole('button', { name: 'send' }));
    });
    expect(message.queryByRole('textbox')).not.toBeInTheDocument();
    expect(input).toHaveValue('Unsent bottom draft');
    expect(input).toBeEnabled();
    expect(useLangchainDraftStore.getState().drafts).toBe(drafts);
    send.mockResolvedValueOnce(false);
    await act(async () => {
      fireEvent.click(bottom.getByRole('button', { name: 'send' }));
    });
    expect(send).toHaveBeenLastCalledWith(
      'Unsent bottom draft',
      expect.objectContaining({ text: 'Unsent bottom draft' })
    );
  });

  it('cancels inline editing without changing the original message or bottom draft', () => {
    const base = useAgentChat('app', null, 'user');
    jest.mocked(useAgentChat).mockReturnValue({
      ...base,
      draftScope: 'thread',
      view: {
        ...base.view,
        conversationId: 'thread',
        messages: [{ id: 'old', role: 'user', content: 'old request' }],
      },
    });
    render(<AgentChat appId="app" conversationId="thread" />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Unsent bottom draft' } });
    const drafts = useLangchainDraftStore.getState().drafts;
    fireEvent.click(screen.getByText('edit-old'));
    const message = within(screen.getByTestId('shared-user'));
    fireEvent.change(message.getByRole('textbox'), {
      target: { value: 'Cancelled correction' },
    });
    fireEvent.click(message.getByRole('button', { name: 'cancel' }));
    expect(message.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.getByTestId('shared-user')).toHaveTextContent('old request');
    expect(input).toHaveValue('Unsent bottom draft');
    expect(input).toBeEnabled();
    expect(useLangchainDraftStore.getState().drafts).toBe(drafts);
    expect(send).not.toHaveBeenCalled();
  });

  it('mounts the shared editor only in the selected user message', () => {
    const base = useAgentChat('app', null, 'user');
    jest.mocked(useAgentChat).mockReturnValue({
      ...base,
      draftScope: 'thread',
      view: {
        ...base.view,
        conversationId: 'thread',
        messages: [
          { id: 'first', role: 'user', content: 'first request' },
          { id: 'second', role: 'user', content: 'second request' },
        ],
      },
    });
    render(<AgentChat appId="app" conversationId="thread" />);
    fireEvent.click(screen.getByText('edit-second'));
    const [first, second] = screen.getAllByTestId('shared-user');
    expect(within(first).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(second).getByRole('textbox')).toHaveValue('second request');
    expect(send).not.toHaveBeenCalled();
  });

  it.each(['busy', 'historyLoading', 'historyFailed', 'unconfirmed'] as const)(
    'blocks message editing when %s',
    state => {
      const base = useAgentChat('app', null, 'user');
      jest.mocked(useAgentChat).mockReturnValue({
        ...base,
        [state]: true,
        draftScope: 'thread',
        view: {
          ...base.view,
          conversationId: 'thread',
          messages: [{ id: 'old', role: 'user', content: 'old request' }],
        },
      });
      render(<AgentChat appId="app" conversationId="thread" />);
      expect(screen.getByText('edit-old')).toBeDisabled();
      fireEvent.click(screen.getByText('edit-old'));
      expect(screen.getByRole('textbox')).toHaveValue('');
      expect(send).not.toHaveBeenCalled();
    }
  );

  it('blocks inline editing while human input is pending or uncertain', () => {
    const base = useAgentChat('app', null, 'user');
    jest.mocked(useAgentChat).mockReturnValue({
      ...base,
      humanInput: true,
      draftScope: 'thread',
      view: {
        ...base.view,
        conversationId: 'thread',
        messages: [{ id: 'old', role: 'user', content: 'old request' }],
      },
    });
    const interactions = jest
      .mocked(useAgentInteractions)
      .getMockImplementation()!({} as never);
    jest.mocked(useAgentInteractions).mockReturnValue({
      ...interactions,
      blocked: true,
      uncertainId: 'confirmation',
    });
    render(<AgentChat appId="app" conversationId="thread" />);
    expect(screen.getByText('edit-old')).toBeDisabled();
    fireEvent.click(screen.getByText('edit-old'));
    expect(
      within(screen.getByTestId('shared-user')).queryByRole('textbox')
    ).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled();
    expect(send).not.toHaveBeenCalled();
  });

  it('preserves the inline correction while recovery blocks further submissions', () => {
    const base = useAgentChat('app', null, 'user');
    const current = {
      ...base,
      draftScope: 'thread',
      view: {
        ...base.view,
        conversationId: 'thread',
        messages: [
          { id: 'old', role: 'user' as const, content: 'old request' },
        ],
      },
    };
    jest.mocked(useAgentChat).mockReturnValue(current);
    const { rerender } = render(
      <AgentChat appId="app" conversationId="thread" />
    );
    fireEvent.click(screen.getByText('edit-old'));
    const message = within(screen.getByTestId('shared-user'));
    fireEvent.change(message.getByRole('textbox'), {
      target: { value: 'Keep this correction' },
    });
    jest.mocked(useAgentChat).mockReturnValue({
      ...current,
      unconfirmed: true,
    });
    rerender(<AgentChat appId="app" conversationId="thread" />);
    expect(message.getByRole('textbox')).toHaveValue('Keep this correction');
    expect(message.getByRole('button', { name: 'send' })).toBeDisabled();
    fireEvent.click(message.getByRole('button', { name: 'send' }));
    fireEvent.submit(screen.getByTestId('shared-input'));
    expect(send).not.toHaveBeenCalled();
  });

  it('unlocks editing after recovery replaces an unconfirmed edit source without consuming the bottom draft', async () => {
    const base = useAgentChat('app', null, 'user');
    const current = {
      ...base,
      draftScope: 'thread',
      view: {
        ...base.view,
        conversationId: 'thread',
        messages: [
          { id: 'old', role: 'user' as const, content: 'old request' },
          { id: 'reply', role: 'assistant' as const, content: 'old answer' },
        ],
      },
    };
    jest.mocked(useAgentChat).mockReturnValue(current);
    const { rerender } = render(
      <AgentChat appId="app" conversationId="thread" />
    );
    const bottom = within(screen.getByTestId('shared-input'));
    const input = bottom.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Unsent bottom draft' } });
    const drafts = useLangchainDraftStore.getState().drafts;
    fireEvent.click(screen.getByText('edit-old'));
    const message = within(screen.getByTestId('shared-user'));
    fireEvent.change(message.getByRole('textbox'), {
      target: { value: 'Recovered correction' },
    });
    send.mockImplementationOnce(async () => {
      jest.mocked(useAgentChat).mockReturnValue({
        ...current,
        unconfirmed: true,
      });
      return false;
    });
    await act(async () => {
      fireEvent.click(message.getByRole('button', { name: 'send' }));
    });
    rerender(<AgentChat appId="app" conversationId="thread" />);
    expect(send).toHaveBeenCalledWith('Recovered correction', undefined, 'old');
    expect(message.getByRole('textbox')).toHaveValue('Recovered correction');
    expect(input).toBeDisabled();
    expect(bottom.getByRole('button', { name: 'send' })).toBeDisabled();
    expect(input).toHaveValue('Unsent bottom draft');
    expect(useLangchainDraftStore.getState().drafts).toBe(drafts);

    jest.mocked(useAgentChat).mockReturnValue({
      ...current,
      unconfirmed: false,
      view: {
        ...current.view,
        messages: [
          { id: 'recovered', role: 'user', content: 'Recovered correction' },
          { id: 'new-reply', role: 'assistant', content: 'Recovered answer' },
        ],
      },
    });
    rerender(<AgentChat appId="app" conversationId="thread" />);
    expect(screen.queryByText('edit-old')).not.toBeInTheDocument();
    expect(screen.queryByText('old request')).not.toBeInTheDocument();
    expect(screen.getByTestId('shared-assistant')).toHaveTextContent(
      'Recovered answer'
    );
    expect(screen.getAllByRole('textbox')).toEqual([input]);
    expect(input).toHaveValue('Unsent bottom draft');
    expect(input).toBeEnabled();
    expect(bottom.getByRole('button', { name: 'send' })).toBeEnabled();
    expect(useLangchainDraftStore.getState().drafts).toBe(drafts);
    expect(screen.getByText('edit-recovered')).toBeEnabled();
    fireEvent.click(screen.getByText('edit-recovered'));
    expect(
      within(screen.getByTestId('shared-user')).getByRole('textbox')
    ).toHaveValue('Recovered correction');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it.each(['conversation', 'application', 'actor', 'epoch'] as const)(
    'clears inline editing when the %s scope changes',
    target => {
      const base = useAgentChat('app', null, 'user');
      const current = {
        ...base,
        draftScope: 'thread',
        view: {
          ...base.view,
          conversationId: 'thread',
          messages: [
            { id: 'old', role: 'user' as const, content: 'old request' },
          ],
        },
      };
      jest.mocked(useAgentChat).mockReturnValue(current);
      const { rerender } = render(
        <AgentChat appId="app" conversationId="thread" />
      );
      fireEvent.click(screen.getByText('edit-old'));
      fireEvent.change(
        within(screen.getByTestId('shared-user')).getByRole('textbox'),
        { target: { value: 'Private correction' } }
      );
      if (target === 'conversation') {
        jest.mocked(useAgentChat).mockReturnValue({
          ...current,
          draftScope: 'other-thread',
          view: { ...current.view, conversationId: 'other-thread' },
        });
      } else if (target === 'actor') {
        mockActorId = 'other-user';
      } else if (target === 'epoch') {
        act(() => {
          syncChatDraftActor(null);
          syncChatDraftActor('user');
        });
      }
      rerender(
        <AgentChat
          appId={target === 'application' ? 'other-app' : 'app'}
          conversationId={target === 'conversation' ? 'other-thread' : 'thread'}
        />
      );
      expect(
        within(screen.getByTestId('shared-user')).queryByRole('textbox')
      ).not.toBeInTheDocument();
      expect(screen.getByRole('textbox')).toHaveValue('');
      expect(send).not.toHaveBeenCalled();
    }
  );

  it('does not offer editing for single-task history or attachment-only text', () => {
    const base = useAgentChat('app', null, 'user');
    jest.mocked(useAgentChat).mockReturnValue({
      ...base,
      singleTask: true,
      draftScope: 'thread',
      view: {
        ...base.view,
        conversationId: 'thread',
        messages: [{ id: 'old', role: 'user', content: 'old request' }],
      },
    });
    render(<AgentChat appId="app" conversationId="thread" />);
    expect(screen.queryByText('edit-old')).not.toBeInTheDocument();
  });

  it.each(['failed', 'unknown', 'cancelled', 'interrupted'] as const)(
    'does not animate unfinished tools restored from a %s run',
    status => {
      const base = useAgentChat('app', null, 'user');
      const restored = restoreAgentView({
        conversationId: 'thread',
        messages: [],
        runs: [
          {
            id: 'run-one',
            executionStatus: status,
            persistenceStatus: 'saved',
            agui: {
              schemaVersion: 2,
              threadId: 'thread',
              runId: 'run-one',
              status,
              messages: [
                {
                  id: 'tool-call',
                  role: 'activity',
                  activityType: AGUI_TOOL_SUMMARY,
                  content: { name: 'Search', status: 'running' },
                },
              ],
              outputMessageIds: ['tool-call'],
              warnings: [],
            },
          },
        ],
      });
      expect(restored.tools[0].status).toBe('running');
      jest.mocked(useAgentChat).mockReturnValue({ ...base, view: restored });
      const { container } = render(
        <AgentChat appId="app" conversationId="thread" />
      );
      expect(container.querySelector('.animate-spin')).toBeNull();
      expect(screen.queryByText('Search')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'view' }));
      expect(screen.getByRole('region', { name: 'title' })).toHaveTextContent(
        'status.unknown'
      );
      expect(
        screen
          .getByRole('region', { name: 'title' })
          .querySelector('.animate-spin')
      ).toBeNull();
      expect(restored.tools[0].status).toBe('running');
    }
  );

  it('shows live tools as running and stops their animation when the run ends', () => {
    const base = useAgentChat('app', null, 'user');
    const live = {
      ...base,
      busy: true,
      view: {
        messages: [],
        runId: 'live-run',
        tools: [
          {
            runId: 'live-run',
            toolCallId: 'tool-call',
            name: 'Search',
            status: 'running',
          },
          {
            runId: 'live-run',
            toolCallId: 'finished-tool',
            name: 'Finished search',
            status: 'completed',
          },
        ],
      },
    };
    jest.mocked(useAgentChat).mockReturnValue(live);
    const { container, rerender } = render(
      <AgentChat appId="app" conversationId={null} />
    );
    expect(container.querySelector('.animate-spin')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'view' }));
    expect(
      screen
        .getByRole('region', { name: 'title' })
        .querySelector('.animate-spin')
    ).not.toBeNull();
    expect(screen.queryByText('historical')).not.toBeInTheDocument();
    jest.mocked(useAgentChat).mockReturnValue({ ...live, busy: false });
    rerender(<AgentChat appId="app" conversationId={null} />);
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(screen.getByText('historical')).toBeInTheDocument();
    expect(screen.getAllByText('status.unknown')).toHaveLength(1);
    expect(screen.getAllByText('status.completed')).toHaveLength(1);
  });

  it('groups process details by run without changing tool timeline order or exposing raw summaries', () => {
    const base = useAgentChat('app', null, 'user');
    jest.mocked(useAgentChat).mockReturnValue({
      ...base,
      view: {
        messages: [],
        tools: [
          {
            runId: 'run-one',
            toolCallId: 'same',
            name: 'Search one',
            status: 'completed',
            order: 1,
            summary: 'PRIVATE_RESULT',
          },
          {
            runId: 'run-one',
            toolCallId: 'next',
            name: 'Write one',
            status: 'running',
            order: 2,
          },
          {
            runId: 'run-two',
            toolCallId: 'same',
            name: 'Search two',
            status: 'completed',
          },
        ],
      },
    });
    const { rerender } = render(
      <AgentChat appId="app" conversationId={null} />
    );
    expect(screen.getAllByRole('button', { name: 'view' })).toHaveLength(2);
    expect(screen.queryByText('Search one')).not.toBeInTheDocument();
    expect(screen.queryByText('Write one')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'view' })[0]);
    const process = screen.getByRole('region', { name: 'title' });
    expect(process.textContent).toContain('Search one');
    expect(process.textContent).toContain('Write one');
    expect(process.textContent).not.toContain('Search two');
    expect(process.textContent).not.toContain('unordered');
    expect(document.body.textContent).not.toContain('PRIVATE_RESULT');
    expect(
      document.querySelectorAll('[data-execution-process-panel]')
    ).toHaveLength(1);
    expect(
      document.querySelector('[data-execution-process-panel]')
    ).toHaveClass('fixed', 'md:right-4');
    fireEvent.click(screen.getByRole('button', { name: 'view' }));
    expect(screen.getAllByRole('region', { name: 'title' })).toHaveLength(1);
    expect(
      screen.getByRole('region', { name: 'title' }).textContent
    ).not.toContain('Search one');
    expect(screen.getByRole('region', { name: 'title' }).textContent).toContain(
      'unordered'
    );
    expect(screen.getByRole('region', { name: 'title' }).textContent).toContain(
      'Search two'
    );
    const selectedTrigger = screen.getByRole('button', { name: 'hide' });
    fireEvent.keyDown(screen.getByRole('region', { name: 'title' }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(selectedTrigger).toHaveFocus();
    fireEvent.click(selectedTrigger);
    jest.mocked(useAgentChat).mockReturnValue({
      ...base,
      draftScope: 'other-conversation',
      view: {
        messages: [],
        tools: [
          {
            runId: 'run-two',
            toolCallId: 'same',
            name: 'Search two',
            status: 'completed',
          },
        ],
      },
    });
    rerender(<AgentChat appId="app" conversationId="other-conversation" />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'view' }));
    mockActorId = 'other-user';
    rerender(<AgentChat appId="app" conversationId="other-conversation" />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    jest.mocked(useAgentChat).mockReturnValue(base);
    rerender(<AgentChat appId="app" conversationId="other-conversation" />);
    expect(
      screen.queryByRole('button', { name: 'view' })
    ).not.toBeInTheDocument();
  });

  it.each(['conversation', 'draft', 'application', 'actor', 'epoch'] as const)(
    'clears the selected process when the %s scope changes and does not reopen it on return',
    target => {
      const base = useAgentChat('app', null, 'user');
      const state = {
        ...base,
        draftScope: 'thread',
        view: {
          messages: [],
          conversationId: 'thread',
          tools: [
            {
              runId: 'run-one',
              toolCallId: 'same',
              name: 'Search',
              status: 'completed',
            },
          ],
        },
      };
      jest.mocked(useAgentChat).mockReturnValue(state);
      const { rerender } = render(
        <AgentChat appId="app" conversationId="thread" />
      );
      fireEvent.click(screen.getByRole('button', { name: 'view' }));
      expect(screen.getByRole('region', { name: 'title' })).toBeInTheDocument();
      if (target === 'conversation')
        jest.mocked(useAgentChat).mockReturnValue({
          ...state,
          draftScope: 'other-thread',
          view: { ...state.view, conversationId: 'other-thread' },
        });
      if (target === 'draft')
        jest.mocked(useAgentChat).mockReturnValue({
          ...state,
          draftScope: 'new:next',
        });
      if (target === 'actor') mockActorId = 'other-user';
      if (target === 'epoch')
        act(() => useLangchainDraftStore.getState().setActor('user', true));
      rerender(
        <AgentChat
          appId={target === 'application' ? 'other-app' : 'app'}
          conversationId={target === 'conversation' ? 'other-thread' : 'thread'}
        />
      );
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
      jest.mocked(useAgentChat).mockReturnValue(state);
      mockActorId = 'user';
      rerender(<AgentChat appId="app" conversationId="thread" />);
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
    }
  );

  it('keeps the selected process during live updates but clears it when its run leaves the timeline', () => {
    const base = useAgentChat('app', null, 'user');
    const state = {
      ...base,
      busy: true,
      view: {
        messages: [],
        runId: 'live-run',
        tools: [
          {
            runId: 'live-run',
            toolCallId: 'first',
            name: 'Search',
            status: 'running',
          },
        ],
      },
    };
    jest.mocked(useAgentChat).mockReturnValue(state);
    const { rerender } = render(
      <AgentChat appId="app" conversationId={null} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'view' }));
    const updated = {
      ...state,
      view: {
        ...state.view,
        tools: [
          { ...state.view.tools[0], status: 'completed' },
          {
            runId: 'live-run',
            toolCallId: 'second',
            name: 'Write',
            status: 'running',
          },
        ],
      },
    };
    jest.mocked(useAgentChat).mockReturnValue(updated);
    rerender(<AgentChat appId="app" conversationId={null} />);
    expect(
      document.querySelectorAll('[data-execution-process-panel]')
    ).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'title' })).toHaveTextContent(
      'Write'
    );
    jest.mocked(useAgentChat).mockReturnValue({
      ...state,
      view: { ...state.view, tools: [] },
    });
    rerender(<AgentChat appId="app" conversationId={null} />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    jest.mocked(useAgentChat).mockReturnValue(updated);
    rerender(<AgentChat appId="app" conversationId={null} />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'view' })).toHaveAttribute(
      'aria-expanded',
      'false'
    );
  });

  it.each([true, false])(
    'shows the batch limit only for a result-enabled app (%s), without blocking input',
    async resultEnabled => {
      jest
        .mocked(useAgentChat)
        .mockImplementation(
          jest.requireActual<typeof import('./use-agent-chat')>(
            './use-agent-chat'
          ).useAgentChat
        );
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          app: { name: 'Agent' },
          ...(resultEnabled
            ? { capabilities: { resultArtifacts: { batchesPerThread: 1 } } }
            : {}),
        }),
      });
      render(<AgentChat appId="app" conversationId={null} />);
      await waitFor(() => expect(screen.getByRole('textbox')).toBeEnabled());
      if (resultEnabled)
        expect(screen.getByText('resultSingleBatch')).toBeVisible();
      else
        expect(screen.queryByText('resultSingleBatch')).not.toBeInTheDocument();
      expect(screen.queryByText('singleTurn')).not.toBeInTheDocument();
    }
  );

  it('remounts and cleans up the chat session on a new login', () => {
    const original = jest.mocked(useAgentChat).getMockImplementation()!(
      'app',
      null
    );
    const cleanup = jest.fn();
    let mounts = 0;
    jest.mocked(useAgentChat).mockImplementation(function useSessionChat() {
      useEffect(() => {
        mounts += 1;
        return cleanup;
      }, []);
      return original;
    });
    syncChatDraftActor('user', 'login-one');
    render(<AgentChat appId="app" conversationId={null} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Old draft' },
    });
    act(() => syncChatDraftActor('user', 'login-two'));
    expect(mounts).toBe(2);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('renders a pending confirmation in the shared chat and blocks ordinary input and deletion', () => {
    const original = jest.mocked(useAgentChat).getMockImplementation()!(
      'app',
      null
    );
    jest.mocked(useAgentChat).mockReturnValue({
      ...original,
      humanInput: true,
      view: { messages: [], tools: [], conversationId: 'conversation' },
    });
    const interactions = jest
      .mocked(useAgentInteractions)
      .getMockImplementation()!({} as never);
    jest.mocked(useAgentInteractions).mockReturnValue({
      ...interactions,
      blocked: true,
      items: [
        {
          id: 'confirmation',
          originRunId: 'run',
          status: 'pending',
          title: 'Synthetic confirmation',
          description: 'Review before continuing',
          actions: ['approve', 'reject'],
          commentMaxLength: 500,
          expiresAt: null,
        },
      ],
    });
    render(<AgentChat appId="app" conversationId="conversation" />);
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'deleteConversation' })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: 'confirmationApprove' })
    ).toBeEnabled();
    fireEvent.change(
      screen.getByRole('textbox', { name: 'confirmationComment' }),
      {
        target: { value: 'Reviewed' },
      }
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'confirmationApprove' })
    );
    expect(interactions.respond).toHaveBeenCalledWith(
      'confirmation',
      'approve',
      'Reviewed'
    );
    expect(send).not.toHaveBeenCalled();
    expect(useAgentInteractions).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: 'user',
        appId: 'app',
        conversationId: 'conversation',
        enabled: true,
      })
    );
  });

  it('exposes only a state check after an uncertain confirmation', () => {
    const original = jest.mocked(useAgentChat).getMockImplementation()!(
      'app',
      null
    );
    jest
      .mocked(useAgentChat)
      .mockReturnValue({ ...original, humanInput: true });
    const interactions = jest
      .mocked(useAgentInteractions)
      .getMockImplementation()!({} as never);
    jest.mocked(useAgentInteractions).mockReturnValue({
      ...interactions,
      uncertainId: 'confirmation',
      blocked: true,
    });
    render(<AgentChat appId="app" conversationId={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'retryStatus' }));
    expect(interactions.check).toHaveBeenCalledTimes(1);
    expect(interactions.respond).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'send' })).toBeDisabled();
  });

  it('shows the confirmation policy rejection through the existing error presentation', () => {
    const original = jest.mocked(useAgentInteractions).getMockImplementation()!(
      {} as never
    );
    jest.mocked(useAgentInteractions).mockReturnValue({
      ...original,
      responseError: new AgentRequestError(429, {
        code: 'AGENT_CONCURRENCY_LIMIT',
        retryable: true,
        source: 'fastify-api',
        severity: 'warn',
        userMessage: 'Another task is active',
        requestId: 'synthetic',
        occurredAt: '2026-01-01T00:00:00Z',
      }),
    });
    render(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Another task is active'
    );
  });

  it.each([false, true])(
    'uses the single-turn end panel once the task ends (human input: %s)',
    humanInput => {
      const original = jest.mocked(useAgentChat).getMockImplementation()!(
        'app',
        null
      );
      const saved = {
        ...original,
        humanInput,
        singleTask: true,
        view: {
          conversationId: 'conversation',
          messages: [
            {
              id: 'answer',
              role: 'assistant' as const,
              content: 'Task complete',
            },
          ],
          tools: [],
        },
      };
      jest.mocked(useAgentChat).mockReturnValue({ ...saved, busy: true });
      const view = render(
        <AgentChat appId="app" conversationId="conversation" />
      );
      expect(
        screen.queryByRole('link', { name: 'newTask' })
      ).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'send' })).toBeDisabled();

      const interactionState = useAgentInteractions({} as never);
      jest.mocked(useAgentChat).mockReturnValue(saved);
      if (humanInput) {
        jest
          .mocked(useAgentInteractions)
          .mockReturnValue({ ...interactionState, blocked: true });
        view.rerender(<AgentChat appId="app" conversationId="conversation" />);
        expect(
          screen.queryByRole('link', { name: 'newTask' })
        ).not.toBeInTheDocument();
        jest.mocked(useAgentInteractions).mockReturnValue(interactionState);
      }
      view.rerender(<AgentChat appId="app" conversationId="conversation" />);
      expect(screen.getByTestId('shared-assistant')).toHaveTextContent(
        'Task complete'
      );
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'send' })
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'deleteConversation' })
      ).toBeEnabled();
      expect(screen.getByText('singleTurn')).toBeVisible();
      expect(screen.getByRole('link', { name: 'newTask' })).toHaveAttribute(
        'href',
        '/apps/agent-chat/app'
      );
    }
  );

  it.each([
    [
      429,
      'AGENT_QUOTA_EXCEEDED',
      false,
      'Usage allowance exhausted',
      'Usage allowance exhausted',
    ],
    [
      429,
      'AGENT_CONCURRENCY_LIMIT',
      true,
      'Another task is active',
      'Another task is active',
    ],
    [400, 'CONTENT_MODERATION_BLOCKED', true, 'Moderation blocked', 'blocked'],
    [
      503,
      'CONTENT_MODERATION_UNAVAILABLE',
      true,
      'Moderation unavailable',
      'unavailable',
    ],
  ] as const)(
    'renders the actual %s/%s policy error',
    (_status, code, retryable, message, expected) => {
      const original = jest.mocked(useAgentChat).getMockImplementation()!(
        'app',
        null
      );
      jest.mocked(useAgentChat).mockReturnValue({
        ...original,
        error: new AgentRequestError(_status, {
          code,
          retryable,
          userMessage: message,
          source: 'fastify-api',
          severity: 'warn',
          requestId: 'synthetic-request',
          occurredAt: '2026-01-01T00:00:00.000Z',
        }),
      });
      render(<AgentChat appId="app" conversationId={null} />);
      expect(screen.getByRole('alert')).toHaveTextContent(expected);
      expect(screen.getByRole('alert')).not.toHaveTextContent('rateLimited');
    }
  );

  it('does not label an unclassified HTTP 429 as the active-run limit', () => {
    const original = jest.mocked(useAgentChat).getMockImplementation()!(
      'app',
      null
    );
    jest
      .mocked(useAgentChat)
      .mockReturnValue({ ...original, error: new AgentRequestError(429) });
    render(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByRole('alert')).toHaveTextContent('requestFailed');
    expect(screen.getByRole('alert')).not.toHaveTextContent('rateLimited');
  });

  it.each([
    [
      429,
      'AGENT_QUOTA_EXCEEDED',
      false,
      'Usage allowance exhausted',
      'Usage allowance exhausted',
    ],
    [
      429,
      'AGENT_CONCURRENCY_LIMIT',
      true,
      'Another task is active',
      'Another task is active',
    ],
    [400, 'CONTENT_MODERATION_BLOCKED', true, 'Moderation blocked', 'blocked'],
    [
      503,
      'CONTENT_MODERATION_UNAVAILABLE',
      true,
      'Moderation unavailable',
      'unavailable',
    ],
    [503, 'AUTH_VERIFY_FAILED', false, 'AUTH_VERIFY_FAILED', 'requestFailed'],
    [
      409,
      'AGENT_RESULT_PROFILE_DISABLED',
      false,
      'AGENT_RESULT_PROFILE_DISABLED',
      'resultProfilePaused',
    ],
    [
      503,
      'AGENT_REQUEST_FAILED',
      false,
      'AGENT_REQUEST_FAILED',
      'requestFailed',
    ],
    [
      429,
      'RATE_LIMITED',
      false,
      'Upstream allowance exhausted',
      'Upstream allowance exhausted',
    ],
  ] as const)(
    'consumes the %s/%s response through the real client, hook and page',
    async (status, code, retryable, userMessage, expected) => {
      jest
        .mocked(useAgentChat)
        .mockImplementation(
          jest.requireActual<typeof import('./use-agent-chat')>(
            './use-agent-chat'
          ).useAgentChat
        );
      global.fetch = jest.fn().mockImplementation(async (_url, init) =>
        init?.method === 'POST'
          ? {
              ok: false,
              status,
              json: async () => ({
                app_error: {
                  code,
                  retryable,
                  userMessage,
                  source: 'fastify-api',
                  severity: 'warn',
                  requestId: 'synthetic-request',
                  occurredAt: '2026-01-01T00:00:00.000Z',
                },
              }),
            }
          : { ok: true, json: async () => ({ app: { name: 'Agent' } }) }
      );
      render(<AgentChat appId="app" conversationId={null} />);
      await waitFor(() =>
        expect(screen.getByRole('textbox')).not.toBeDisabled()
      );
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'Rejected input' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'send' }));
      await waitFor(() =>
        expect(screen.getByRole('alert')).toHaveTextContent(expected)
      );
      if (
        code !== 'CONTENT_MODERATION_BLOCKED' &&
        code !== 'CONTENT_MODERATION_UNAVAILABLE'
      )
        expect(screen.getByRole('alert')).toHaveTextContent(
          'synthetic-request'
        );
      expect(screen.getByRole('textbox')).toHaveValue('Rejected input');
      expect(screen.getByRole('alert')).not.toHaveTextContent('rateLimited');
      expect(global.fetch).toHaveBeenCalledTimes(2);
    }
  );

  it('preserves a rejected draft without resubmitting', async () => {
    send.mockResolvedValue(false);
    render(<AgentChat appId="app" conversationId={null} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() =>
      expect(send).toHaveBeenCalledWith(
        'Keep this draft',
        expect.objectContaining({
          text: 'Keep this draft',
          revision: expect.any(Number),
        })
      )
    );
    expect(input).toHaveValue('Keep this draft');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('clears an accepted draft', async () => {
    send.mockResolvedValue(true);
    render(<AgentChat appId="app" conversationId={null} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Accepted input' } });
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() => expect(input).toHaveValue(''));
  });

  it('restores separate drafts across application A -> B -> A', () => {
    const { rerender } = render(
      <AgentChat appId="app-A" conversationId={null} />
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'A draft' },
    });
    rerender(<AgentChat appId="app-B" conversationId={null} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'B draft' },
    });
    rerender(<AgentChat appId="app-A" conversationId={null} />);
    expect(screen.getByRole('textbox')).toHaveValue('A draft');
    rerender(<AgentChat appId="app-B" conversationId={null} />);
    expect(screen.getByRole('textbox')).toHaveValue('B draft');
  });

  it('restores a draft after the entire AgentChat unmounts and remounts', () => {
    const first = render(<AgentChat appId="app" conversationId={null} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Keep on remount' },
    });
    first.unmount();
    render(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByRole('textbox')).toHaveValue('Keep on remount');
  });

  it('restores conversation-specific drafts after navigation and remounting', () => {
    const original = jest.mocked(useAgentChat).getMockImplementation()!(
      'app',
      null
    );
    jest.mocked(useAgentChat).mockReturnValue({
      ...original,
      draftScope: 'conversation-A',
    });
    const first = render(
      <AgentChat appId="app" conversationId="conversation-A" />
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Conversation A draft' },
    });
    jest.mocked(useAgentChat).mockReturnValue({
      ...original,
      draftScope: 'conversation-B',
    });
    first.rerender(<AgentChat appId="app" conversationId="conversation-B" />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Conversation B draft' },
    });
    first.unmount();
    jest.mocked(useAgentChat).mockReturnValue({
      ...original,
      draftScope: 'conversation-A',
    });
    const second = render(
      <AgentChat appId="app" conversationId="conversation-A" />
    );
    expect(screen.getByRole('textbox')).toHaveValue('Conversation A draft');
    jest.mocked(useAgentChat).mockReturnValue({
      ...original,
      draftScope: 'conversation-B',
    });
    second.rerender(<AgentChat appId="app" conversationId="conversation-B" />);
    expect(screen.getByRole('textbox')).toHaveValue('Conversation B draft');
  });

  it('restores a newer new-conversation draft when the remounted controller resets its target version', () => {
    const original = jest.mocked(useAgentChat).getMockImplementation()!(
      'app',
      null
    );
    const first = render(<AgentChat appId="app" conversationId={null} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Old new draft' },
    });
    jest
      .mocked(useAgentChat)
      .mockReturnValue({ ...original, draftScope: 'new:1' });
    first.rerender(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Latest new draft' },
    });
    first.unmount();
    jest.mocked(useAgentChat).mockReturnValue(original);
    render(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByRole('textbox')).toHaveValue('Latest new draft');
  });

  it('restores unsent follow-up edits by the accepted conversation ID after remounting', () => {
    const original = jest.mocked(useAgentChat).getMockImplementation()!(
      'app',
      null
    );
    const first = render(<AgentChat appId="app" conversationId={null} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Unsent follow-up' },
    });
    jest.mocked(useAgentChat).mockReturnValue({
      ...original,
      view: { ...original.view, conversationId: 'accepted-conversation' },
    });
    first.rerender(
      <AgentChat appId="app" conversationId="accepted-conversation" />
    );
    first.unmount();
    jest.mocked(useAgentChat).mockReturnValue({
      ...original,
      draftScope: 'accepted-conversation',
      view: { ...original.view, conversationId: 'accepted-conversation' },
    });
    render(<AgentChat appId="app" conversationId="accepted-conversation" />);
    expect(screen.getByRole('textbox')).toHaveValue('Unsent follow-up');
  });

  it('consumes only the submitted application snapshot after navigating away', async () => {
    let accept!: (value: boolean) => void;
    send.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          accept = resolve;
        })
    );
    const { rerender } = render(
      <AgentChat appId="app-A" conversationId={null} />
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Submit A' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    rerender(<AgentChat appId="app-B" conversationId={null} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Keep B' },
    });
    await act(async () => accept(true));
    expect(screen.getByRole('textbox')).toHaveValue('Keep B');
    rerender(<AgentChat appId="app-A" conversationId={null} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('does not clear edits made after remounting when the old submission is accepted', async () => {
    let accept!: (value: boolean) => void;
    send.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          accept = resolve;
        })
    );
    const first = render(<AgentChat appId="app" conversationId={null} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Submitted' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    first.unmount();
    render(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByRole('textbox')).toHaveValue('Submitted');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Changed after remount' },
    });
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Submitted' },
    });
    await act(async () => accept(true));
    expect(screen.getByRole('textbox')).toHaveValue('Submitted');
  });

  it('does not overwrite a newer draft when acceptance resolves late', async () => {
    let accept: (value: boolean) => void = () => undefined;
    send.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          accept = resolve;
        })
    );
    render(<AgentChat appId="app" conversationId={null} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'First input' } });
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    fireEvent.change(input, { target: { value: 'New draft' } });
    accept(true);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(input).toHaveValue('New draft');
  });

  it('uses the product input and message components for multiple assistant messages', () => {
    const chat = jest.mocked(useAgentChat).getMockImplementation()!(
      'app',
      null
    );
    jest.mocked(useAgentChat).mockReturnValue({
      ...chat,
      view: {
        messages: [
          { id: 'u', role: 'user', content: 'Question' },
          { id: 'a1', role: 'assistant', content: 'First' },
          { id: 'a2', role: 'assistant', content: 'Second' },
        ],
        tools: [],
      },
    });
    render(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByTestId('shared-input')).toBeInTheDocument();
    expect(screen.getAllByTestId('shared-user')).toHaveLength(1);
    expect(screen.getAllByTestId('shared-assistant')).toHaveLength(2);
  });

  it('isolates drafts across conversation navigation and late acceptance', async () => {
    let accept: (accepted: boolean) => void = () => undefined;
    send.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          accept = resolve;
        })
    );
    const original = jest.mocked(useAgentChat).getMockImplementation()!(
      'app',
      null
    );
    const { rerender } = render(
      <AgentChat appId="app" conversationId={null} />
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Original' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    jest
      .mocked(useAgentChat)
      .mockReturnValue({ ...original, draftScope: 'other' });
    rerender(<AgentChat appId="app" conversationId="other" />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Other draft' },
    });
    accept(true);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('textbox')).toHaveValue('Other draft');
    jest.mocked(useAgentChat).mockReturnValue(original);
    rerender(<AgentChat appId="app" conversationId={null} />);
    await waitFor(() => expect(screen.getByRole('textbox')).toHaveValue(''));
  });

  it('drops the prior account draft and resets application-local state', () => {
    const { rerender } = render(
      <AgentChat appId="app" conversationId={null} />
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Private draft' },
    });
    mockActorId = 'other-user';
    rerender(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Other application draft' },
    });
    rerender(<AgentChat appId="second-app" conversationId={null} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
    mockActorId = 'user';
    rerender(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('preserves drafts during auth loading but clears them on confirmed logout', () => {
    const { rerender } = render(
      <AgentChat appId="app" conversationId={null} />
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Private draft' },
    });
    mockActorId = null;
    mockAuthLoading = true;
    rerender(<AgentChat appId="app" conversationId={null} />);
    expect(Object.values(useLangchainDraftStore.getState().drafts)).toEqual([
      expect.objectContaining({ text: 'Private draft' }),
    ]);
    mockActorId = 'user';
    mockAuthLoading = false;
    rerender(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByRole('textbox')).toHaveValue('Private draft');
    mockActorId = null;
    rerender(<AgentChat appId="app" conversationId={null} />);
    expect(useLangchainDraftStore.getState().drafts).toEqual({});
    mockActorId = 'user';
    rerender(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByRole('textbox')).toHaveValue('');
  });

  it('ignores a prior account acceptance after switching away and back', async () => {
    let accept!: (value: boolean) => void;
    send.mockImplementation(
      () =>
        new Promise<boolean>(resolve => {
          accept = resolve;
        })
    );
    const { rerender } = render(
      <AgentChat appId="app" conversationId={null} />
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Same text' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    mockActorId = 'other-user';
    rerender(<AgentChat appId="app" conversationId={null} />);
    mockActorId = 'user';
    rerender(<AgentChat appId="app" conversationId={null} />);
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Same text' },
    });
    await act(async () => accept(true));
    expect(screen.getByRole('textbox')).toHaveValue('Same text');
  });
});
