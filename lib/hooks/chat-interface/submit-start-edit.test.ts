import { streamDifyChat } from '@lib/services/dify/chat-service';

import { resolveDbConversationUuidByExternalId } from './conversation-db';
import { startExistingChatConversation } from './submit-start';

jest.mock('./conversation-db', () => ({
  resolveDbConversationUuidByExternalId: jest.fn(),
}));

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

it('lets the server stage the pending edit and forwards a stable submission identity', async () => {
  const input = {
    ...fixture(),
    submissionId: 'submission',
    onDispatch: jest.fn(),
  };
  await startExistingChatConversation(input);
  expect(input.saveMessage).not.toHaveBeenCalled();
  expect(input.onDispatch).toHaveBeenCalledTimes(1);
  expect(jest.mocked(streamDifyChat).mock.calls[0][4]).toEqual({
    submissionId: 'submission',
  });
  expect(jest.mocked(streamDifyChat).mock.calls[0][0]).toMatchObject({
    query: 'Revised question',
    editSourceId: 'source-db-id',
    editMessageId: 'msg-browser-id',
    conversation_id: 'native',
  });
});

it('does not dispatch a revision without a local conversation binding', async () => {
  jest
    .mocked(resolveDbConversationUuidByExternalId)
    .mockResolvedValueOnce(null);
  await expect(
    startExistingChatConversation({ ...fixture(), dbConversationUUID: null })
  ).rejects.toThrow('could not be saved');
  expect(streamDifyChat).not.toHaveBeenCalled();
});
