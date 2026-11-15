import { ConfirmDialog } from '@components/ui/confirm-dialog';
import { InputDialog } from '@components/ui/input-dialog';
import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import {
  deleteConversation,
  renameConversation,
} from '@lib/services/client/conversations-api';
import { syncChatDraftActor } from '@lib/stores/chat-draft-lifecycle';
import { act, render } from '@testing-library/react';

import { ConversationTitleButton } from './conversation-title-button';

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/chat/external',
  useParams: () => ({}),
}));
jest.mock('@lib/hooks/use-chat-interface', () => ({
  useChatInterface: () => ({ conversationAppId: null }),
}));
jest.mock('@lib/stores/chat-store', () => ({
  useChatStore: () => ({ currentConversationId: 'external' }),
}));
jest.mock('@lib/stores/app-list-store', () => ({
  useAppListStore: () => ({ apps: [] }),
}));
jest.mock('@lib/stores/favorite-apps-store', () => ({
  useFavoriteAppsStore: () => ({}),
}));
jest.mock('@lib/hooks/use-all-conversations', () => ({
  useAllConversations: () => ({ conversations: [] }),
}));
jest.mock('@lib/hooks/use-combined-conversations', () => ({
  conversationEvents: { emit: jest.fn() },
  useCombinedConversations: () => ({
    conversations: [
      { id: 'external', db_pk: 'database', title: 'Private previous title' },
    ],
    refresh: jest.fn(),
  }),
}));
jest.mock('@lib/services/client/conversations-api', () => ({
  deleteConversation: jest.fn(),
  renameConversation: jest.fn(),
}));
jest.mock('@components/ui/input-dialog', () => ({
  InputDialog: jest.fn(() => null),
}));
jest.mock('@components/ui/confirm-dialog', () => ({
  ConfirmDialog: jest.fn(() => null),
}));

beforeEach(() => {
  jest.clearAllMocks();
  syncChatDraftActor(null);
  syncChatDraftActor('first', 'login-one');
  jest.spyOn(window, 'alert').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

it.each(['rename', 'delete'])(
  'does not dispatch an old retained %s confirmation',
  async operation => {
    render(<ConversationTitleButton />);
    const rename = jest.mocked(InputDialog).mock.calls.at(-1)![0].onConfirm;
    const remove = jest.mocked(ConfirmDialog).mock.calls.at(-1)![0].onConfirm;
    act(() => syncChatDraftActor('second'));
    await act(async () => {
      if (operation === 'rename') await rename('old');
      else await remove();
    });
    expect(renameConversation).not.toHaveBeenCalled();
    expect(deleteConversation).not.toHaveBeenCalled();
  }
);

it.each(['rename', 'delete'])(
  'ignores a late %s result after identity changes',
  async operation => {
    let complete!: () => void;
    const response = new Promise(resolve => {
      complete = () => resolve({ success: true });
    });
    if (operation === 'rename')
      jest
        .mocked(renameConversation)
        .mockReturnValueOnce(response as ReturnType<typeof renameConversation>);
    else
      jest
        .mocked(deleteConversation)
        .mockReturnValueOnce(response as ReturnType<typeof deleteConversation>);
    render(<ConversationTitleButton />);
    const rename = jest.mocked(InputDialog).mock.calls.at(-1)![0].onConfirm;
    const remove = jest.mocked(ConfirmDialog).mock.calls.at(-1)![0].onConfirm;
    let work!: Promise<unknown>;
    act(() => {
      work = (operation === 'rename'
        ? rename('old')
        : remove()) as unknown as Promise<unknown>;
    });
    act(() => syncChatDraftActor('second'));
    await act(async () => {
      complete();
      await work;
    });
    expect(conversationEvents.emit).not.toHaveBeenCalled();
    expect(window.alert).not.toHaveBeenCalled();
  }
);

it('ignores a late failure after a new login for the same account', async () => {
  let fail!: () => void;
  jest.mocked(renameConversation).mockReturnValueOnce(
    new Promise((_resolve, reject) => {
      fail = () => reject(new Error('synthetic failure'));
    })
  );
  render(<ConversationTitleButton />);
  const confirm = jest.mocked(InputDialog).mock.calls.at(-1)![0].onConfirm;
  let work!: Promise<unknown>;
  act(() => {
    work = confirm('old') as unknown as Promise<unknown>;
  });
  act(() => syncChatDraftActor('first', 'login-two'));
  await act(async () => {
    fail();
    await work;
  });
  expect(conversationEvents.emit).not.toHaveBeenCalled();
  expect(window.alert).not.toHaveBeenCalled();
});

it('keeps same-login rename working', async () => {
  jest
    .mocked(renameConversation)
    .mockResolvedValueOnce({ success: true, data: {} } as never);
  render(<ConversationTitleButton />);
  const confirm = jest.mocked(InputDialog).mock.calls.at(-1)![0].onConfirm;
  await act(async () => {
    await confirm('new title');
  });
  expect(renameConversation).toHaveBeenCalledWith('database', 'new title');
  expect(conversationEvents.emit).toHaveBeenCalledTimes(1);
});
