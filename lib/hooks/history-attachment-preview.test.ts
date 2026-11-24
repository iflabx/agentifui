import { getConversationMessages } from '@lib/services/dify/message-service';
import type { ConversationMessage } from '@lib/services/dify/types';
import type { ChatMessage } from '@lib/stores/chat-store';

import {
  applyAttachmentPreviewIds,
  fetchAttachmentPreviewIds,
  hasPendingAttachmentPreviewSync,
  resolveHistoryAttachmentPreviewUserId,
} from './history-attachment-preview';

jest.mock('@lib/services/dify/message-service');

const toolKey = '00000000-0000-4000-8000-000000000002.png';

function createUserMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'user-1',
    text: 'open the markdown',
    isUser: true,
    attachments: [
      {
        id: 'upload-file-1',
        name: 'notes.md',
        size: 128,
        type: 'text/markdown',
        upload_file_id: 'upload-file-1',
      },
    ],
    ...overrides,
  };
}

function createAssistantMessage(
  overrides: Partial<ChatMessage> = {}
): ChatMessage {
  return {
    id: 'assistant-1',
    text: 'done',
    isUser: false,
    dify_message_id: 'dify-msg-1',
    ...overrides,
  };
}

function createDifyMessage(
  overrides: Partial<ConversationMessage> = {}
): ConversationMessage {
  return {
    id: 'dify-msg-1',
    conversation_id: 'conv-1',
    inputs: {},
    query: 'open the markdown',
    answer: 'done',
    message_files: [
      {
        id: 'preview-file-1',
        type: 'document',
        url: 'https://example.com/file',
        belongs_to: 'user',
      },
    ],
    created_at: 1,
    feedback: null,
    retriever_resources: [],
    ...overrides,
  };
}

describe('history attachment preview helpers', () => {
  it('prefers the auth session user id for Dify history lookups', () => {
    expect(
      resolveHistoryAttachmentPreviewUserId({
        sessionUserId: 'auth-user-1',
        profileUserId: 'profile-user-1',
      })
    ).toBe('auth-user-1');

    expect(
      resolveHistoryAttachmentPreviewUserId({
        sessionUserId: '   ',
        profileUserId: 'profile-user-1',
      })
    ).toBe('profile-user-1');
  });

  it('detects pending sync only when preview ids are still missing and streaming is done', () => {
    expect(
      hasPendingAttachmentPreviewSync([
        createUserMessage(),
        createAssistantMessage(),
      ])
    ).toBe(true);

    expect(
      hasPendingAttachmentPreviewSync([
        createUserMessage({
          attachments: [
            {
              id: 'upload-file-1',
              name: 'notes.md',
              size: 128,
              type: 'text/markdown',
              upload_file_id: 'upload-file-1',
              preview_file_id: 'preview-file-1',
            },
          ],
        }),
      ])
    ).toBe(false);

    expect(
      hasPendingAttachmentPreviewSync([
        createUserMessage(),
        createAssistantMessage({ isStreaming: true }),
      ])
    ).toBe(false);
  });

  it('fills preview_file_id by matching the following assistant dify message id', () => {
    const messages = [createUserMessage(), createAssistantMessage()];
    const difyMessages = [createDifyMessage()];

    expect(applyAttachmentPreviewIds(messages, difyMessages)).toEqual([
      createUserMessage({
        attachments: [
          {
            id: 'upload-file-1',
            name: 'notes.md',
            size: 128,
            type: 'text/markdown',
            upload_file_id: 'upload-file-1',
            preview_file_id: 'preview-file-1',
          },
        ],
      }),
      createAssistantMessage(),
    ]);
  });

  it('uses the upload file id for historical previews', () => {
    const difyMessages = [
      createDifyMessage({
        message_files: [
          {
            id: 'message-file-record-1',
            upload_file_id: 'upload-file-1',
            type: 'document',
            url: 'https://example.com/file',
            belongs_to: 'user',
          },
        ],
      }),
    ];

    expect(
      applyAttachmentPreviewIds(
        [createUserMessage(), createAssistantMessage()],
        difyMessages
      )[0]?.attachments
    ).toEqual([expect.objectContaining({ preview_file_id: 'upload-file-1' })]);
  });

  it('falls back to matching the Dify query text when assistant external ids are unavailable', () => {
    const messages = [
      createUserMessage({ id: 'user-2', text: 'same prompt' }),
      createAssistantMessage({ id: 'assistant-2', dify_message_id: undefined }),
    ];

    const difyMessages = [
      createDifyMessage({
        id: 'dify-msg-2',
        query: 'same prompt',
        message_files: [
          {
            id: 'preview-file-2',
            type: 'document',
            url: 'https://example.com/file-2',
            belongs_to: 'user',
          },
        ],
      }),
    ];

    expect(
      applyAttachmentPreviewIds(messages, difyMessages)[0]?.attachments
    ).toEqual([
      expect.objectContaining({
        preview_file_id: 'preview-file-2',
      }),
    ]);
  });

  it('hydrates only the saved assistant reply matched by native message ID', () => {
    const reply = createAssistantMessage({ db_id: 'local-message' });
    const files = [{ key: toolKey, image: true, name: 'chart.png', size: 4 }];
    const messages = applyAttachmentPreviewIds(
      [
        reply,
        createAssistantMessage({
          id: 'other',
          db_id: 'other-local',
          dify_message_id: 'other-native',
        }),
      ],
      [createDifyMessage({ result_files: [null!, ...files] })]
    );
    expect(messages[0].difyResultFiles).toEqual([
      {
        id: toolKey,
        upload_file_id: toolKey,
        name: 'chart.png',
        size: 4,
        type: 'image/*',
        source: 'dify-output',
        resultMessageId: 'local-message',
      },
    ]);
    expect(messages[1].difyResultFiles).toEqual([]);
    expect(hasPendingAttachmentPreviewSync(messages)).toBe(false);
  });

  it('looks up a saved result on an older history page', async () => {
    const load = jest.mocked(getConversationMessages);
    load
      .mockReset()
      .mockResolvedValueOnce({
        data: [createDifyMessage({ id: 'cursor' })],
        has_more: true,
        limit: 20,
      })
      .mockResolvedValueOnce({
        data: [
          createDifyMessage({
            result_files: [
              { key: toolKey, image: true, name: 'chart.png', size: 4 },
            ],
          }),
        ],
        has_more: false,
        limit: 100,
      });
    const messages = await fetchAttachmentPreviewIds({
      appId: 'app',
      conversationId: 'conv-1',
      userId: 'owner',
      chatMessages: [createAssistantMessage({ db_id: 'local-message' })],
    });
    expect(load).toHaveBeenNthCalledWith(
      2,
      'app',
      expect.objectContaining({ first_id: 'cursor' })
    );
    expect(messages[0].difyResultFiles?.[0]).toMatchObject({
      resultMessageId: 'local-message',
      name: 'chart.png',
    });
  });
});
