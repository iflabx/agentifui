import { getChatflowInitialInputs } from '@lib/services/client/messages-api';
import {
  chatInputScope,
  useChatInputStore,
} from '@lib/stores/chat-input-store';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useChatflowInitialInputs } from './use-chatflow-initial-inputs';

jest.mock('@lib/services/client/messages-api', () => ({
  getChatflowInitialInputs: jest.fn(),
}));
const scope = (conversation = 'saved') =>
  chatInputScope(
    useChatInputStore.getState().actorEpoch,
    'actor',
    'app',
    'conversation:' + conversation
  );

beforeEach(() => {
  jest.resetAllMocks();
  useChatInputStore.getState().setActor('actor');
  jest.mocked(getChatflowInitialInputs).mockResolvedValue({
    success: true,
    data: { topic: 'initial settings outside latest page' },
  });
});

it('reads initialization separately when a long history does not load the first message', async () => {
  const { result } = renderHook(() =>
    useChatflowInitialInputs(scope(), undefined)
  );
  expect(result.current.loading).toBe(true);
  await waitFor(() =>
    expect(result.current.value).toEqual({
      topic: 'initial settings outside latest page',
    })
  );
  expect(getChatflowInitialInputs).toHaveBeenCalledWith('saved');
});

it('keeps the original summary after an edited first message leaves the visible path', async () => {
  const { result, rerender } = renderHook(
    ({ local }) => useChatflowInitialInputs(scope(), local),
    { initialProps: { local: { topic: 'initial' } as unknown } }
  );
  expect(result.current.value).toEqual({ topic: 'initial' });
  expect(getChatflowInitialInputs).not.toHaveBeenCalled();
  rerender({ local: undefined });
  await waitFor(() =>
    expect(result.current.value).toEqual({
      topic: 'initial settings outside latest page',
    })
  );
});

it('does not let a late response replace another conversation summary', async () => {
  let complete!: (value: {
    success: true;
    data: Record<string, unknown>;
  }) => void;
  jest.mocked(getChatflowInitialInputs).mockReturnValueOnce(
    new Promise(resolve => {
      complete = resolve;
    })
  );
  const { result, rerender } = renderHook(
    ({ current }) => useChatflowInitialInputs(current, undefined),
    { initialProps: { current: scope('A') } }
  );
  rerender({ current: scope('B') });
  await waitFor(() => expect(result.current.value).not.toBeNull());
  await act(async () =>
    complete({ success: true, data: { topic: 'stale A' } })
  );
  expect(result.current.value).toEqual({
    topic: 'initial settings outside latest page',
  });
});

it('distinguishes failed retrieval from older history with no summary and supports retry', async () => {
  jest
    .mocked(getChatflowInitialInputs)
    .mockRejectedValueOnce(new Error('unavailable'));
  const { result } = renderHook(() =>
    useChatflowInitialInputs(scope(), undefined)
  );
  await waitFor(() => expect(result.current.failed).toBe(true));
  jest
    .mocked(getChatflowInitialInputs)
    .mockResolvedValueOnce({ success: true, data: null });
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect(result.current.failed).toBe(false);
  expect(result.current.value).toBeNull();
});
