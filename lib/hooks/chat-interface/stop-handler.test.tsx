import { act, renderHook } from '@testing-library/react';

import { useChatStopHandler } from './stop-handler';
import { executeChatStop } from './stop-flow';

jest.mock('./stop-flow', () => ({
  executeChatStop: jest.fn(),
}));

describe('useChatStopHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (executeChatStop as jest.Mock).mockResolvedValue(undefined);
  });

  it('delegates stop handling to executeChatStop', async () => {
    const input: Parameters<typeof useChatStopHandler>[0] = {
      currentUserId: 'user-1',
      currentAppId: 'app-1',
      currentAppInstance: {
        id: 'instance-1',
        provider_id: 'provider-1',
        display_name: 'Test Instance',
        description: null,
        instance_id: 'inst-1',
        api_path: '/api/test',
        is_default: false,
        visibility: 'private',
        config: {},
        created_at: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T00:00:00.000Z',
      },
      dbConversationUUID: 'db-1',
      difyConversationId: 'conv-1',
      isSubmittingRef: { current: true },
      appendTimerRef: { current: null },
      setDbConversationUUID: jest.fn(),
      setCurrentTaskId: jest.fn(),
      setIsWaitingForResponse: jest.fn(),
      markAsManuallyStopped: jest.fn(),
      flushChunkBuffer: jest.fn(),
      updateMessage: jest.fn(),
      saveMessage: jest.fn(),
      finalizeStreamingMessage: jest.fn(),
    };

    const { result } = renderHook(() => useChatStopHandler(input));

    await act(async () => {
      await result.current();
    });

    expect(executeChatStop).toHaveBeenCalledWith(input);
  });
});
