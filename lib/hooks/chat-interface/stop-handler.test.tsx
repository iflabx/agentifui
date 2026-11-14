import { act, renderHook } from '@testing-library/react';

import { executeChatStop } from './stop-flow';
import { useChatStopHandler } from './stop-handler';

jest.mock('./stop-flow', () => ({
  executeChatStop: jest.fn(),
}));

describe('useChatStopHandler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (executeChatStop as jest.Mock).mockResolvedValue(undefined);
  });

  it('delegates stop handling to executeChatStop', async () => {
    const stopResult = { confirmed: true, current: true, taskId: 'task-1' };
    jest.mocked(executeChatStop).mockResolvedValue(stopResult);
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
      saveStoppedAssistantMessage: jest.fn(),
      finalizeStreamingMessage: jest.fn(),
    };

    const { result, rerender } = renderHook(
      ({ path }) => useChatStopHandler({ ...input, currentPathname: path }),
      { initialProps: { path: '/chat/A' } }
    );

    await act(async () => {
      expect(await result.current()).toBe(stopResult);
    });

    expect(executeChatStop).toHaveBeenCalledWith({
      ...input,
      isCurrent: expect.any(Function),
    });
    const owner = jest.mocked(executeChatStop).mock.calls[0][0];
    expect(owner.isCurrent?.()).toBe(true);
    rerender({ path: '/chat/B' });
    rerender({ path: '/chat/A' });
    expect(owner.isCurrent?.()).toBe(false);
  });
});
