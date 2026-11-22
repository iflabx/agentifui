import { streamDifyChat } from '@lib/services/dify/chat-service';

import { startExistingChatConversation } from './submit-start';

jest.mock('@lib/services/dify/chat-service', () => ({
  streamDifyChat: jest.fn(),
}));

function fixture(saveMessage = jest.fn().mockResolvedValue(true)) {
  return {
    editSourceId: 'source-db-id',
    message: 'Revised question',
    appId: 'app',
    currentUserId: 'actor',
    difyConversationId: 'native',
    dbConversationUUID: 'local',
    userMessage: {
      id: 'msg-browser-id',
      text: 'Revised question',
      isUser: true,
    },
    currentPathname: '/chat/native',
    saveMessage,
    setDifyConversationId: jest.fn(),
    setCurrentConversationId: jest.fn(),
    setDbConversationUUID: jest.fn(),
    setCurrentTaskId: jest.fn(),
    navigateToConversation: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(streamDifyChat).mockResolvedValue({
    answerStream: (async function* () {
      yield 'answer';
    })(),
    getConversationId: () => 'native',
    getTaskId: () => 'task',
  });
});

it('persists the revised user message and attachments before dispatch, forwarding only text and edit identity', async () => {
  let saved!: (value: boolean) => void;
  const save = jest.fn(
    () =>
      new Promise<boolean>(resolve => {
        saved = resolve;
      })
  );
  const input = fixture(save);
  const pending = startExistingChatConversation(input);
  expect(save).toHaveBeenCalledWith(input.userMessage, 'local');
  expect(streamDifyChat).not.toHaveBeenCalled();
  saved(true);
  await pending;
  expect(jest.mocked(streamDifyChat).mock.calls[0][0]).toMatchObject({
    query: 'Revised question',
    editSourceId: 'source-db-id',
    editMessageId: 'msg-browser-id',
    conversation_id: 'native',
  });
});

it('does not dispatch a revision whose local user message could not be saved', async () => {
  await expect(
    startExistingChatConversation(fixture(jest.fn().mockResolvedValue(false)))
  ).rejects.toThrow('could not be saved');
  expect(streamDifyChat).not.toHaveBeenCalled();
});
