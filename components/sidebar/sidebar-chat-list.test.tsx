import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { InputDialog } from '@components/ui/input-dialog';
import { useCombinedConversations } from '@lib/hooks/use-combined-conversations';
import {
  deleteConversation,
  renameConversation,
} from '@lib/services/client/conversations-api';
import { agentRequest } from '@lib/services/client/langchain-api';
import { syncChatDraftActor } from '@lib/stores/chat-draft-lifecycle';
import { usePendingConversationStore } from '@lib/stores/pending-conversation-store';
import { act, fireEvent, render, screen } from '@testing-library/react';

import type { ReactNode } from 'react';

import { SidebarChatList } from './sidebar-chat-list';

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

jest.mock('@lib/hooks/use-combined-conversations', () => ({
  useCombinedConversations: jest.fn(),
}));
jest.mock('@lib/hooks/use-recent-task-executions', () => ({
  useRecentTaskExecutions: () => ({ executions: [], isLoading: false }),
}));
jest.mock('@lib/services/client/conversations-api', () => ({
  deleteConversation: jest.fn(),
  renameConversation: jest.fn(),
}));
jest.mock('@lib/services/client/langchain-api', () => ({
  agentRequest: jest.fn(),
}));
jest.mock('@components/langchain/routing', () => ({
  langchainConversationPath: (item: { app_id?: string }) =>
    item.app_id ? '/apps/agent/test' : null,
  isCurrentLangchainConversation: () => true,
}));
jest.mock('@components/sidebar/sidebar-chat-list/recent-item', () => ({
  SidebarRecentItemRow: ({
    chat,
    moreActionsTrigger,
  }: {
    chat: { title: string };
    moreActionsTrigger: ReactNode;
  }) => (
    <div>
      {chat.title}
      {moreActionsTrigger}
    </div>
  ),
}));
jest.mock('@components/ui/dropdown-menu-v2', () => ({
  DropdownMenuV2: Object.assign(
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
jest.mock('@components/ui/input-dialog', () => ({
  InputDialog: jest.fn(
    ({
      isOpen,
      onConfirm,
      defaultValue,
    }: {
      isOpen: boolean;
      onConfirm: (title: string) => void;
      defaultValue: string;
    }) =>
      isOpen ? (
        <div role="dialog">
          {defaultValue}
          <button onClick={() => onConfirm('renamed')}>confirm rename</button>
        </div>
      ) : null
  ),
}));
jest.mock('@components/ui/confirm-dialog', () => ({
  ConfirmDialog: jest.fn(
    ({ isOpen, onConfirm }: { isOpen: boolean; onConfirm: () => void }) =>
      isOpen ? (
        <div role="dialog">
          <button onClick={onConfirm}>confirm delete</button>
        </div>
      ) : null
  ),
}));

function deferred() {
  let resolve!: (value: { success: boolean }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ success: boolean }>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const refresh = jest.fn();
const item = {
  id: 'external',
  db_pk: 'database',
  title: 'private title',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
  isPending: false,
};
const props = {
  contentVisible: true,
  selectedId: null,
  onSelectChat: jest.fn(),
  onSelectTaskExecution: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  syncChatDraftActor(null);
  syncChatDraftActor('first');
  jest.mocked(useCombinedConversations).mockReturnValue({
    conversations: [item],
    isLoading: false,
    refresh,
  } as unknown as ReturnType<typeof useCombinedConversations>);
  jest.spyOn(window, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it.each(['rename', 'delete'])(
  'closes the old %s dialog on identity change',
  operation => {
    render(<SidebarChatList {...props} />);
    fireEvent.click(screen.getByText(operation));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => syncChatDraftActor('second'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleteConversation).not.toHaveBeenCalled();
    expect(renameConversation).not.toHaveBeenCalled();
  }
);

it.each(['rename', 'delete'])(
  'does not dispatch a retained old %s confirmation',
  async operation => {
    render(<SidebarChatList {...props} />);
    fireEvent.click(screen.getByText(operation));
    const renameConfirm = jest.mocked(InputDialog).mock.calls.at(-1)![0]
      .onConfirm;
    const deleteConfirm = jest.mocked(ConfirmDialog).mock.calls.at(-1)![0]
      .onConfirm;
    act(() => syncChatDraftActor('second'));
    await act(async () => {
      if (operation === 'rename') await renameConfirm('old title');
      else await deleteConfirm();
    });
    expect(renameConversation).not.toHaveBeenCalled();
    expect(deleteConversation).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  }
);

it.each(['rename', 'delete', 'agent-delete'])(
  'ignores a late %s success and preserves a new dialog',
  async operation => {
    const pending = deferred();
    if (operation === 'agent-delete') {
      jest.mocked(useCombinedConversations).mockReturnValue({
        conversations: [{ ...item, app_id: 'agent' }],
        isLoading: false,
        refresh,
      } as unknown as ReturnType<typeof useCombinedConversations>);
      jest.mocked(agentRequest).mockReturnValue(pending.promise);
    } else if (operation === 'rename')
      jest
        .mocked(renameConversation)
        .mockReturnValue(
          pending.promise as ReturnType<typeof renameConversation>
        );
    else
      jest
        .mocked(deleteConversation)
        .mockReturnValue(
          pending.promise as ReturnType<typeof deleteConversation>
        );
    render(<SidebarChatList {...props} />);
    const action = operation === 'rename' ? 'rename' : 'delete';
    fireEvent.click(screen.getByText(action));
    fireEvent.click(screen.getByText(`confirm ${action}`));
    act(() => syncChatDraftActor('second'));
    fireEvent.click(screen.getByText('rename'));
    await act(async () => pending.resolve({ success: true }));
    expect(refresh).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  }
);

it('does not show a late failure in another account', async () => {
  const pending = deferred();
  jest
    .mocked(deleteConversation)
    .mockReturnValue(pending.promise as ReturnType<typeof deleteConversation>);
  render(<SidebarChatList {...props} />);
  fireEvent.click(screen.getByText('delete'));
  fireEvent.click(screen.getByText('confirm delete'));
  act(() => syncChatDraftActor('second'));
  await act(async () => pending.reject(new Error('private failure')));
  expect(window.alert).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});

it('removes the persisted optimistic entry after actual deletion', async () => {
  const store = usePendingConversationStore.getState();
  store.addPending('temp', 'private title');
  store.setRealIdAndStatus('temp', 'external', 'title_resolved');
  store.markAsPersistedComplete('temp', 'database');
  jest
    .mocked(deleteConversation)
    .mockResolvedValue({ success: true, data: true });
  render(<SidebarChatList {...props} />);
  fireEvent.click(screen.getByText('delete'));
  await act(async () => fireEvent.click(screen.getByText('confirm delete')));
  expect(usePendingConversationStore.getState().pendingConversations.size).toBe(
    0
  );
  expect(refresh).toHaveBeenCalledTimes(1);
});
