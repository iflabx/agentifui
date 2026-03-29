import { applyChatCompletionMetadata } from './stream-consume';
import type { ChatStreamCompletionData } from './types';

const mockGetChatStoreState = jest.fn();

jest.mock('@lib/stores/chat-store', () => ({
  useChatStore: {
    getState: (...args: unknown[]) => mockGetChatStoreState(...args),
  },
}));

describe('applyChatCompletionMetadata', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    mockGetChatStoreState.mockReturnValue({
      messages: [
        {
          id: 'assistant-1',
          text: 'final answer',
          isUser: false,
          metadata: {
            stopped_manually: false,
            attachments: [],
          },
          sequence_index: 1,
          token_count: undefined,
        },
      ],
    });
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('applies completion metadata immediately when the promise resolves in time', async () => {
    const updateMessage = jest.fn();

    await applyChatCompletionMetadata({
      completionPromise: Promise.resolve({
        usage: { total_tokens: 42 },
        metadata: { model: 'deepseek' },
        retrieverResources: [],
      }),
      assistantMessageId: 'assistant-1',
      updateMessage,
      waitTimeoutMs: 50,
    });

    expect(updateMessage).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({
        token_count: 42,
        persistenceStatus: 'pending',
        metadata: expect.objectContaining({
          dify_metadata: { model: 'deepseek' },
          dify_usage: { total_tokens: 42 },
          dify_retriever_resources: [],
          frontend_metadata: expect.objectContaining({
            sequence_index: 1,
          }),
        }),
      })
    );
  });

  it('stops blocking after the timeout and still applies metadata when it resolves later', async () => {
    jest.useFakeTimers();

    const updateMessage = jest.fn();
    let resolveCompletion!: (value: ChatStreamCompletionData) => void;

    const completionPromise = new Promise<ChatStreamCompletionData>(resolve => {
      resolveCompletion = resolve;
    });

    const metadataTask = applyChatCompletionMetadata({
      completionPromise,
      assistantMessageId: 'assistant-1',
      updateMessage,
      waitTimeoutMs: 50,
    });

    await jest.advanceTimersByTimeAsync(50);
    await metadataTask;

    expect(updateMessage).not.toHaveBeenCalled();

    resolveCompletion({
      usage: { total_tokens: 7 },
      metadata: { delayed: true },
      retrieverResources: [],
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(updateMessage).toHaveBeenCalledWith(
      'assistant-1',
      expect.objectContaining({
        token_count: 7,
        persistenceStatus: 'pending',
        metadata: expect.objectContaining({
          dify_metadata: { delayed: true },
        }),
      })
    );
  });
});
