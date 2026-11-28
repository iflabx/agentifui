import { ConfirmDialog, InputDialog } from '@components/ui';
import { useAllConversations } from '@lib/hooks/use-all-conversations';
import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import { agentRequest } from '@lib/services/client/langchain-api';
import { searchHistoryMessages } from '@lib/services/client/messages-api';
import { syncChatDraftActor } from '@lib/stores/chat-draft-lifecycle';
import type { Conversation } from '@lib/types/database';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import type { ReactNode } from 'react';

import { History } from './index';

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@lib/hooks/use-all-conversations', () => ({
  useAllConversations: jest.fn(),
}));
jest.mock('@lib/hooks/use-chat-interface', () => ({
  useChatInterface: () => ({ clearConversationState: jest.fn() }),
}));
jest.mock('@lib/hooks/use-chat-width', () => ({ useChatWidth: () => ({}) }));
jest.mock('@lib/hooks/use-date-formatter', () => ({
  DateFormatPresets: {},
  useDateFormatter: () => ({ formatDate: () => '' }),
}));
jest.mock('@lib/hooks/use-combined-conversations', () => ({
  conversationEvents: { emit: jest.fn(), subscribe: () => jest.fn() },
}));
jest.mock('@lib/services/client/langchain-api', () => ({
  agentRequest: jest.fn(),
}));
jest.mock('@lib/services/client/messages-api', () => ({
  searchHistoryMessages: jest.fn(),
}));
jest.mock('@components/ui', () => ({
  SearchInput: ({
    value,
    onValueChange,
  }: {
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <input
      aria-label="History search"
      value={value}
      onChange={event => onValueChange(event.target.value)}
    />
  ),
  InputDialog: jest.fn(
    ({ isOpen, defaultValue }: { isOpen: boolean; defaultValue: string }) =>
      isOpen ? <div role="dialog">{defaultValue}</div> : null
  ),
  ConfirmDialog: jest.fn(({ isOpen }: { isOpen: boolean }) =>
    isOpen ? <div role="dialog">delete confirmation</div> : null
  ),
}));
jest.mock('@components/ui/dropdown-menu', () => ({
  DropdownMenu: Object.assign(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
    {
      Item: ({
        children,
        onClick,
      }: {
        children: ReactNode;
        onClick: () => void;
      }) => <button onClick={onClick}>{children}</button>,
    }
  ),
}));

const refresh = jest.fn();
const rename = jest.fn();
const remove = jest.fn();
const item = {
  id: 'conversation',
  title: 'Private previous title',
} as Conversation;

function list(conversations: Conversation[]) {
  jest.mocked(useAllConversations).mockReturnValue({
    userId: 'first',
    actorEpoch: 0,
    error: null,
    conversations,
    isLoading: false,
    total: conversations.length,
    refresh,
    renameConversation: rename,
    deleteConversation: remove,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  syncChatDraftActor(null);
  syncChatDraftActor('first', 'login-one');
  jest.spyOn(window, 'alert').mockImplementation(() => undefined);
  list([item]);
});

afterEach(() => jest.restoreAllMocks());

it('keeps message pages scoped to the current search and links to the saved message', async () => {
  const search = jest.mocked(searchHistoryMessages);
  const makePage = (id: string, nextCursor: string | null = null) => ({
    success: true as const,
    data: {
      hits: [
        {
          id,
          conversationId: 'conversation',
          title: 'Original conversation',
          role: 'assistant' as const,
          snippet: `Current [a] match for ${id}`,
        },
      ],
      nextCursor,
    },
  });
  let finishOldSearch!: (result: Awaited<ReturnType<typeof search>>) => void;
  search
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishOldSearch = resolve;
        })
    )
    .mockResolvedValueOnce(makePage('latest', 'latest'))
    .mockResolvedValueOnce(makePage('earlier'));
  render(<History />);
  const input = screen.getByRole('textbox', { name: 'History search' });
  fireEvent.change(input, { target: { value: 'old' } });
  await waitFor(() => expect(search).toHaveBeenCalledWith('old', undefined));
  fireEvent.change(input, { target: { value: 'current [a]' } });
  const match = await screen.findByRole('link', { name: /match for latest/ });
  expect(match).toHaveAttribute('href', '/chat/conversation?messageId=latest');
  expect(match.querySelector('mark')).toHaveTextContent('Current [a]');
  await act(async () => finishOldSearch(makePage('stale')));
  expect(screen.queryByText(/match for stale/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'more' }));
  expect(await screen.findByText(/match for earlier/)).toBeInTheDocument();
  expect(screen.getByText(/match for latest/)).toBeInTheDocument();
  expect(search).toHaveBeenLastCalledWith('current [a]', 'latest');
  act(() => syncChatDraftActor('second', 'login-two'));
  expect(screen.queryByText(/match for latest/)).not.toBeInTheDocument();
});

it.each(['second', 'first'])(
  'discards an open private history dialog on a new login for %s',
  actor => {
    render(<History />);
    fireEvent.click(screen.getByText('rename'));
    expect(screen.getByRole('dialog')).toHaveTextContent(item.title!);
    list([]);
    act(() => syncChatDraftActor(actor, 'login-two'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  }
);

it('does not dispatch retained history confirmations after identity changes', async () => {
  render(<History />);
  fireEvent.click(screen.getByText('rename'));
  const confirmRename = jest.mocked(InputDialog).mock.calls.at(-1)![0]
    .onConfirm;
  fireEvent.click(screen.getByText('delete'));
  const confirmDelete = jest
    .mocked(ConfirmDialog)
    .mock.calls.filter(([props]) => props.title === 'deleteDialog.title')
    .at(-1)![0].onConfirm;
  list([]);
  act(() => syncChatDraftActor('second'));
  await act(async () => {
    await confirmRename('old title');
    await confirmDelete();
  });
  expect(rename).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  expect(agentRequest).not.toHaveBeenCalled();
});

it.each(['success', 'failure'])(
  'ignores late history rename %s',
  async outcome => {
    let complete!: () => void;
    rename.mockImplementationOnce(
      () =>
        new Promise((resolve, reject) => {
          complete = () =>
            outcome === 'success'
              ? resolve(true)
              : reject(new Error('synthetic failure'));
        })
    );
    render(<History />);
    fireEvent.click(screen.getByText('rename'));
    const confirm = jest.mocked(InputDialog).mock.calls.at(-1)![0].onConfirm;
    let work!: Promise<unknown>;
    act(() => {
      work = confirm('renamed') as unknown as Promise<unknown>;
    });
    list([]);
    act(() => syncChatDraftActor('second'));
    await act(async () => {
      complete();
      await work;
    });
    expect(refresh).not.toHaveBeenCalled();
    expect(conversationEvents.emit).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
  }
);

it('ignores a late agent deletion in a batch after identity changes', async () => {
  list([
    {
      ...item,
      app_id: 'agent',
      metadata: { backend_type: 'langchain' },
    } as Conversation,
  ]);
  let complete!: () => void;
  jest.mocked(agentRequest).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        complete = () => resolve(undefined);
      })
  );
  render(<History />);
  fireEvent.click(screen.getByText('batchDelete'));
  fireEvent.click(screen.getByText('selectAll'));
  const confirm = jest.mocked(ConfirmDialog).mock.calls.at(-1)![0].onConfirm;
  let work!: Promise<unknown>;
  act(() => {
    work = confirm() as unknown as Promise<unknown>;
  });
  expect(agentRequest).toHaveBeenCalledTimes(1);
  list([]);
  act(() => syncChatDraftActor('second'));
  await act(async () => {
    complete();
    await work;
  });
  expect(conversationEvents.emit).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  expect(window.alert).not.toHaveBeenCalled();
});

it('retains ordinary same-login rename behavior', async () => {
  rename.mockResolvedValueOnce(true);
  render(<History />);
  fireEvent.click(screen.getByText('rename'));
  const confirm = jest.mocked(InputDialog).mock.calls.at(-1)![0].onConfirm;
  await act(async () => {
    await confirm('renamed');
  });
  expect(rename).toHaveBeenCalledWith(item.id, 'renamed');
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(conversationEvents.emit).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
