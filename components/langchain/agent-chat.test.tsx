import { useLangchainDraftStore } from '@lib/stores/langchain-draft-store';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { AgentChat } from './agent-chat';
import { useAgentChat } from './use-agent-chat';

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
jest.mock('./use-agent-chat', () => ({ useAgentChat: jest.fn() }));
jest.mock('@lib/hooks/use-chat-width', () => ({
  useChatWidth: () => ({ widthClass: 'max-w-3xl', paddingClass: 'px-4' }),
}));
jest.mock('@components/chat/chat-input-backdrop', () => ({
  ChatInputBackdrop: () => null,
}));
jest.mock('@components/chat-input/view', () => ({
  ChatInputView: ({
    value,
    onValueChange,
    onSubmit,
    disabled,
  }: {
    value: string;
    onValueChange: (text: string) => void;
    onSubmit: () => void;
    disabled?: boolean;
  }) => (
    <div data-testid="shared-input">
      <textarea
        value={value}
        onChange={event => onValueChange(event.target.value)}
        disabled={disabled}
      />
      <button onClick={onSubmit} disabled={disabled}>
        send
      </button>
    </div>
  ),
}));
jest.mock('@components/chat/messages/user-message/user-message', () => ({
  UserMessage: ({ id, content }: { id: string; content: string }) => (
    <div data-testid="shared-user" data-message-id={id}>
      {content}
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

  beforeEach(() => {
    jest.clearAllMocks();
    useLangchainDraftStore.getState().setActor(null);
    mockActorId = 'user';
    mockAuthLoading = false;
    jest.mocked(useAgentChat).mockReturnValue({
      view: { messages: [], tools: [] },
      draftScope: 'new:0',
      appName: 'Agent',
      ready: true,
      busy: false,
      error: null,
      unconfirmed: false,
      historyLoading: false,
      historyFailed: false,
      send,
      select: jest.fn(),
      remove: jest.fn(),
      newConversation: jest.fn(),
    });
  });

  it('reserves space for fixed desktop and mobile shell navigation', () => {
    render(<AgentChat appId="app" conversationId={null} />);
    expect(screen.getByRole('main')).toHaveClass('pt-16', 'md:pt-12');
  });

  it('preserves a rejected draft without resubmitting', async () => {
    send.mockResolvedValue(false);
    render(<AgentChat appId="app" conversationId={null} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() => expect(send).toHaveBeenCalledWith('Keep this draft'));
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
