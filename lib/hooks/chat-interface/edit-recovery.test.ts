import { AppRequestError } from '@lib/errors/app-error';
import { agentSubmissionRequest } from '@lib/services/client/langchain-api';
import { getMessagePage } from '@lib/services/client/messages-api';
import { useChatStore } from '@lib/stores/chat-store';

import { isDefiniteEditRejection, pendingDifyEdit } from './edit-recovery';

jest.mock('@lib/services/client/langchain-api', () => ({
  agentSubmissionRequest: jest.fn(),
}));
jest.mock('@lib/services/client/messages-api', () => ({
  getMessagePage: jest.fn(),
}));

const options = {
  appId: 'app',
  submissionId: 'submission',
  conversationId: 'conversation',
  sourceId: 'old-db',
  messageId: 'new-client',
  isCurrent: () => true,
};
beforeEach(() => {
  jest.clearAllMocks();
  useChatStore.setState({
    messages: [
      { id: 'prefix', db_id: 'prefix-db', text: 'earlier', isUser: true },
      { id: 'old', db_id: 'old-db', text: 'old', isUser: true },
      { id: 'old-answer', text: 'old answer', isUser: false },
      { id: 'new-client', text: 'revised', isUser: true },
    ],
  });
});

it('does not classify network errors, timeouts or ambiguous conflicts as rejection', () => {
  for (const error of [
    new Error('offline'),
    new AppRequestError('timeout', 408),
    new AppRequestError('upstream', 500),
    new AppRequestError('conflict', 409),
    new AppRequestError('upstream rate limit', 429),
  ])
    expect(isDefiniteEditRejection(error)).toBe(false);
  expect(isDefiniteEditRejection(new AppRequestError('denied', 403))).toBe(
    true
  );
});

it('only removes its local attempted message after confirmed rejection', async () => {
  jest
    .mocked(agentSubmissionRequest)
    .mockResolvedValue({ state: 'rejected', runId: null });
  expect(await pendingDifyEdit(options).check!()).toBe(false);
  expect(useChatStore.getState().messages.map(message => message.id)).toEqual([
    'prefix',
    'old',
    'old-answer',
  ]);
});

it.each(['registered', 'admitted', 'submitting'])(
  'keeps %s uncertain and never resubmits',
  async state => {
    jest
      .mocked(agentSubmissionRequest)
      .mockResolvedValue({ state, runId: null });
    expect(await pendingDifyEdit(options).check!()).toBeNull();
    expect(getMessagePage).not.toHaveBeenCalled();
    expect(useChatStore.getState().messages).toHaveLength(4);
  }
);

it.each(['accepted', 'unknown', 'finished'])(
  'adopts authoritative history for %s only after the activated edit binding is present',
  async state => {
    jest
      .mocked(agentSubmissionRequest)
      .mockResolvedValue({ state, runId: null });
    jest.mocked(getMessagePage).mockResolvedValue({
      success: true,
      data: {
        hasMore: false,
        nextCursor: null,
        messages: [
          {
            id: 'revised-db',
            role: 'user',
            content: 'revision',
            metadata: {
              client_message_id: 'new-client',
              edit_source_id: 'old-db',
            },
          },
        ],
      },
    } as never);
    expect(await pendingDifyEdit(options).check!()).toBe(true);
    expect(
      useChatStore.getState().messages.map(message => message.text)
    ).toEqual(['earlier', 'revision']);
  }
);

it('does not mistake a pending or unrelated history row for acceptance', async () => {
  jest
    .mocked(agentSubmissionRequest)
    .mockResolvedValue({ state: 'unknown', runId: null });
  jest.mocked(getMessagePage).mockResolvedValue({
    success: true,
    data: {
      hasMore: false,
      nextCursor: null,
      messages: [
        {
          id: 'pending',
          role: 'user',
          metadata: {
            client_message_id: 'new-client',
            edit_pending: true,
            edit_pending_source_id: 'old-db',
          },
        },
      ],
    },
  } as never);
  expect(await pendingDifyEdit(options).check!()).toBeNull();
  expect(useChatStore.getState().messages).toHaveLength(4);
});

it('ignores late recovery after the user changes identity or route', async () => {
  let current = true;
  jest.mocked(agentSubmissionRequest).mockImplementation(async () => {
    current = false;
    return { state: 'rejected', runId: null };
  });
  expect(
    await pendingDifyEdit({ ...options, isCurrent: () => current }).check!()
  ).toBeNull();
  expect(useChatStore.getState().messages).toHaveLength(4);
});
