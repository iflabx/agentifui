import { History } from '@components/history';
import { agentRequest } from '@lib/services/client/langchain-api';
import type { Conversation } from '@lib/types/database';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockPush = jest.fn();
const mockDeleteLegacy = jest.fn();
const mockRefresh = jest.fn();
const mockEmit = jest.fn();
const mockSubscribe = jest.fn(() => jest.fn());
let mockConversations: Conversation[];

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('@lib/hooks/use-all-conversations', () => ({
  useAllConversations: () => ({
    conversations: mockConversations,
    total: mockConversations.length,
    isLoading: false,
    refresh: mockRefresh,
    deleteConversation: mockDeleteLegacy,
  }),
}));
jest.mock('@lib/hooks/use-combined-conversations', () => ({
  conversationEvents: {
    subscribe: () => mockSubscribe(),
    emit: () => mockEmit(),
  },
}));
jest.mock('@lib/hooks/use-chat-interface', () => ({
  useChatInterface: () => ({}),
}));
jest.mock('@lib/hooks/use-chat-width', () => ({ useChatWidth: () => ({}) }));
jest.mock('@lib/services/client/langchain-api', () => ({
  agentRequest: jest.fn(),
}));
jest.mock('@components/ui', () => ({
  ConfirmDialog: () => null,
  SearchInput: () => null,
}));
jest.mock('@components/history/history-selection-bar', () => ({
  HistorySelectionBar: () => null,
}));
jest.mock('@components/history/history-list', () => ({
  HistoryList: ({
    onConversationClick,
    onDelete,
  }: {
    onConversationClick: (id: string) => void;
    onDelete: (id: string) => Promise<boolean>;
  }) => (
    <>
      <button onClick={() => onConversationClick('local-id')}>Open</button>
      <button onClick={() => void onDelete('local-id')}>Delete</button>
    </>
  ),
}));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(agentRequest).mockResolvedValue(undefined);
  mockDeleteLegacy.mockResolvedValue(true);
  mockConversations = [
    {
      id: 'local-id',
      app_id: 'service-uuid',
      interaction_protocol: 'ag-ui/1.0',
      title: 'Example',
      metadata: { backend_type: 'dify' },
    } as unknown as Conversation,
  ];
});

it('opens a trusted Dify binding publicly without consulting the app opt-in', () => {
  render(<History />);
  fireEvent.click(screen.getByRole('button', { name: 'Open' }));
  expect(mockPush).toHaveBeenCalledWith(
    '/apps/agent-chat/service-uuid?conversationId=local-id'
  );
});

it.each(['dify', 'langchain'])(
  'deletes a bound %s conversation only through the server-managed endpoint',
  async backend => {
    mockConversations[0].metadata = { backend_type: backend };
    render(<History />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mockEmit).toHaveBeenCalled());
    expect(agentRequest).toHaveBeenCalledWith(
      'service-uuid',
      '/conversations/local-id',
      { method: 'DELETE' }
    );
    expect(mockDeleteLegacy).not.toHaveBeenCalled();
  }
);

it('keeps unbound Dify on the old delete path even with misleading protocol metadata', async () => {
  mockConversations[0].interaction_protocol = null;
  mockConversations[0].metadata = {
    backend_type: 'dify',
    interaction_protocol: 'ag-ui/1.0',
  };
  render(<History />);
  fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
  await waitFor(() =>
    expect(mockDeleteLegacy).toHaveBeenCalledWith('local-id')
  );
  expect(agentRequest).not.toHaveBeenCalled();
});

it('does not fall back to the old delete path when public deletion fails', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    jest.mocked(agentRequest).mockRejectedValue(new Error('unavailable'));
    render(<History />);
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(log).toHaveBeenCalled());
    expect(mockDeleteLegacy).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});
