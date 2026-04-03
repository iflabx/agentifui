import type { ConversationMessage } from '@lib/services/dify/types';
import type { ChatMessage } from '@lib/stores/chat-store';

import {
  applyAttachmentPreviewIds,
  hasPendingAttachmentPreviewSync,
} from './history-attachment-preview';

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
});
