import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { AgentChat } from './agent-chat';
import { useAgentChat } from './use-agent-chat';

jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => ({ session: { user: { id: 'user' } }, loading: false }),
}));
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('react-markdown', () => ({ __esModule: true, default: () => null }));
jest.mock('remark-gfm', () => ({ __esModule: true, default: () => undefined }));
jest.mock('./use-agent-chat', () => ({ useAgentChat: jest.fn() }));

describe('Agent chat draft', () => {
  const send = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(useAgentChat).mockReturnValue({
      view: { messages: [], tools: [] },
      conversations: [],
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
});
