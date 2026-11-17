import {
  adoptChatflowExecutionPath,
  bindChatflowExecutionView,
} from '@lib/hooks/use-chatflow-execution-view';
import { getConversationByExternalId } from '@lib/services/client/conversations-api';
import { getMessagePage } from '@lib/services/client/messages-api';
import {
  chatInputScope,
  useChatInputStore,
} from '@lib/stores/chat-input-store';
import { useChatStore } from '@lib/stores/chat-store';
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';
import { useCurrentAppStore } from '@lib/stores/current-app-store';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import ChatPage from '../../../app/(shell)/chat/[conversationId]/page';

let mockId = 'temp-one';
let mockLoaderMounts = 0;
let mockActor = 'actor';

function useMockInterface() {
  const messages = useChatStore(state => state.messages);
  const execution = useChatflowExecutionStore();
  return {
    messages,
    conversationAppId: 'app',
    isProcessing: false,
    handleSubmit: jest.fn(),
    handleStopProcessing: jest.fn(),
    sendDirectMessage: jest.fn(),
    nodeTracker: execution,
  };
}

jest.mock('next/navigation', () => ({
  useParams: () => ({ conversationId: mockId }),
  usePathname: () => `/chat/${mockId}`,
}));
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => ({
    session: { user: { id: mockActor } },
    loading: false,
  }),
}));
jest.mock('@lib/hooks/use-chat-interface', () => ({
  useChatInterface: () => useMockInterface(),
}));
jest.mock('@lib/hooks/use-chatflow-interface', () => ({
  useChatflowInterface: () => useMockInterface(),
}));
jest.mock('@lib/hooks/use-chatflow-detection', () => ({
  useChatflowDetection: () => ({ isChatflowApp: true }),
}));
jest.mock('@lib/hooks/use-chat-page-state', () => ({
  useChatPageState: () => ({
    isWelcomeScreen: false,
    isSubmitting: false,
    wrapHandleSubmit: (handler: unknown) => handler,
  }),
}));
jest.mock('@lib/hooks/use-chat-scroll', () => ({
  useChatScroll: () => ({ current: null }),
}));
jest.mock('@lib/hooks/use-profile', () => ({ useProfile: () => ({}) }));
jest.mock('@lib/hooks/use-history-attachment-preview-sync', () => ({
  useHistoryAttachmentPreviewSync: () => undefined,
}));
jest.mock('@lib/services/client/conversations-api', () => ({
  getConversationByExternalId: jest.fn(),
}));
jest.mock('@lib/services/client/messages-api', () => ({
  getMessagePage: jest.fn(),
}));
jest.mock('@components/chat', () => ({
  ChatLoader: function MockChatLoader() {
    const React = jest.requireActual('react');
    React.useEffect(() => {
      mockLoaderMounts += 1;
    }, []);
    const messages = useChatStore(state => state.messages);
    return (
      <div data-testid="messages">
        {messages.map(item => item.text).join(' ')}
      </div>
    );
  },
  ChatInputBackdrop: () => null,
  MessagesLoadingIndicator: () => <div>More history</div>,
  PageLoadingSpinner: () => null,
  ScrollToBottomButton: () => null,
  WelcomeScreen: () => null,
}));
jest.mock('@components/chat-input', () => ({ ChatInput: () => null }));
jest.mock('@components/chat/dynamic-suggested-questions', () => ({
  DynamicSuggestedQuestions: () => null,
}));
jest.mock('@components/file-preview/file-preview-canvas', () => ({
  FilePreviewCanvas: () => null,
}));
jest.mock('@components/langchain/agent-chat', () => ({
  AgentChat: () => <div>Agent view</div>,
}));
jest.mock('@components/chatflow/chatflow-node-tracker', () => ({
  ChatflowNodeTracker: () => <div>Execution process</div>,
}));
jest.mock('@components/chatflow/chatflow-floating-controller', () => ({
  ChatflowFloatingController: ({
    onToggleTracker,
  }: {
    onToggleTracker: () => void;
  }) => <button onClick={onToggleTracker}>Toggle process</button>,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockId = 'temp-one';
  mockActor = 'actor';
  mockLoaderMounts = 0;
  useChatflowExecutionStore.setState(
    useChatflowExecutionStore.getInitialState()
  );
  useChatInputStore.getState().setActor('actor');
  const input = useChatInputStore.getState();
  input.setCurrentRoute(
    chatInputScope(input.actorEpoch, 'actor', 'app', 'draft')
  );
  useCurrentAppStore.setState({ currentAppId: 'app' });
  useChatStore.setState({
    currentConversationId: 'temp-one',
    messages: [{ id: 'answer', text: 'Completed summary', isUser: false }],
  });
  jest.mocked(getConversationByExternalId).mockResolvedValue({
    success: true,
    data: { id: 'database-id', app_id: 'app', user_id: 'actor' } as never,
  });
  jest.mocked(getMessagePage).mockResolvedValue({
    success: true,
    data: { messages: [], hasMore: false, nextCursor: null },
  });
});

it.each([false, true])(
  'does not remount, reload messages or clear the completed process on promotion (closed=%s)',
  closed => {
    const input = useChatInputStore.getState();
    const view = bindChatflowExecutionView(
      {
        actorId: 'actor',
        actorEpoch: input.actorEpoch,
        appId: 'app',
        draftScope: input.currentRoute,
      },
      '/chat/temp-one'
    );
    useChatflowExecutionStore.getState().startExecution();
    useChatflowExecutionStore.getState().addNode({
      id: 'summary',
      title: 'Summary',
      status: 'running',
      startTime: 123,
    });
    const { rerender } = render(<ChatPage />);
    const messages = screen.getByTestId('messages');
    expect(screen.getByText('Execution process')).toBeInTheDocument();
    if (closed)
      fireEvent.click(screen.getByRole('button', { name: 'Toggle process' }));
    act(() => {
      useChatflowExecutionStore
        .getState()
        .updateNode('summary', { status: 'completed' });
      useChatflowExecutionStore
        .getState()
        .handleNodeEvent({ event: 'workflow_finished' });
    });
    act(() => {
      adoptChatflowExecutionPath(view, '/chat/real-one');
      useChatStore.setState({ currentConversationId: 'real-one' });
      mockId = 'real-one';
    });
    rerender(<ChatPage />);
    expect(screen.getByTestId('messages')).toBe(messages);
    expect(messages).toHaveTextContent('Completed summary');
    expect(mockLoaderMounts).toBe(1);
    expect(getConversationByExternalId).not.toHaveBeenCalled();
    expect(getMessagePage).not.toHaveBeenCalled();
    expect(useChatflowExecutionStore.getState().nodes).toHaveLength(1);
    expect(Boolean(screen.queryByText('Execution process'))).toBe(!closed);
    if (closed) {
      fireEvent.click(screen.getByRole('button', { name: 'Toggle process' }));
      expect(screen.getByText('Execution process')).toBeInTheDocument();
    }
  }
);

it('still loads a historical conversation and selects its trusted AG-UI protocol', async () => {
  mockId = 'historical';
  jest.mocked(getConversationByExternalId).mockResolvedValue({
    success: true,
    data: {
      id: 'local-agent-id',
      app_id: 'agent-app',
      interaction_protocol: 'ag-ui/1.0',
    } as never,
  });
  render(<ChatPage />);
  await waitFor(() =>
    expect(screen.getByText('Agent view')).toBeInTheDocument()
  );
  expect(screen.queryByTestId('messages')).not.toBeInTheDocument();
  expect(getConversationByExternalId).toHaveBeenCalledWith('historical');
});

it('does not bypass a failed historical protocol lookup', async () => {
  mockId = 'unavailable';
  jest
    .mocked(getConversationByExternalId)
    .mockResolvedValue({ success: false, error: new Error('unavailable') });
  render(<ChatPage />);
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('requestFailed')
  );
  expect(screen.queryByTestId('messages')).not.toBeInTheDocument();
});

it('keeps historical pagination when starting an execution in an existing conversation', async () => {
  mockId = 'historical';
  useChatStore.setState({ currentConversationId: 'historical', messages: [] });
  jest.mocked(getMessagePage).mockResolvedValue({
    success: true,
    data: {
      messages: [
        {
          id: 'old-answer',
          content: 'Previous answer',
          role: 'assistant',
          created_at: '2026-01-01T00:00:00Z',
          metadata: {},
        } as never,
      ],
      hasMore: true,
      nextCursor: 'older-page',
    },
  });
  render(<ChatPage />);
  await waitFor(() =>
    expect(screen.getByText('More history')).toBeInTheDocument()
  );
  const messages = screen.getByTestId('messages');
  act(() => {
    const input = useChatInputStore.getState();
    bindChatflowExecutionView(
      {
        actorId: 'actor',
        actorEpoch: input.actorEpoch,
        appId: 'app',
        draftScope: input.currentRoute,
      },
      '/chat/historical'
    );
  });
  expect(screen.getByTestId('messages')).toBe(messages);
  expect(screen.getByText('More history')).toBeInTheDocument();
  expect(getMessagePage).toHaveBeenCalledTimes(1);
});
