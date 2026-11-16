import { act, renderHook } from '@testing-library/react';

import { useChatflowState } from './use-chatflow-state';

const makeInterface = (startTime?: number) => ({
  messages: [],
  handleSubmit: jest.fn().mockResolvedValue(undefined),
  isProcessing: false,
  handleStopProcessing: jest.fn(),
  sendDirectMessage: jest.fn().mockResolvedValue(undefined),
  nodeTracker: {
    nodes: startTime === undefined ? [] : [{ status: 'running', startTime }],
    isExecuting: startTime !== undefined,
    executionProgress: { current: 0, total: 0, percentage: 0 },
    error: null,
  },
});

it('does not reopen a manually closed process on every node update, but permits the next run', () => {
  const initial = makeInterface();
  const { result, rerender } = renderHook(
    ({ scope, input }) =>
      useChatflowState({
        scope,
        isChatflowApp: true,
        chatflowInterface: input,
        regularInterface: input,
      }),
    { initialProps: { scope: 'conversation-one', input: initial } }
  );
  const start = Date.now() - 1000;
  rerender({ scope: 'conversation-one', input: makeInterface(start) });
  expect(result.current.showNodeTracker).toBe(true);
  act(() => result.current.setShowNodeTracker(false));
  rerender({ scope: 'conversation-one', input: makeInterface(start) });
  expect(result.current.showNodeTracker).toBe(false);
  rerender({ scope: 'conversation-one', input: makeInterface(start + 1) });
  expect(result.current.showNodeTracker).toBe(true);
  rerender({ scope: 'conversation-two', input: makeInterface() });
  expect(result.current.showNodeTracker).toBe(false);
});

it('preserves a manual close before the first node arrives and resets it for a new execution', () => {
  const initial = makeInterface();
  const waiting = makeInterface();
  waiting.nodeTracker.isExecuting = true;
  const { result, rerender } = renderHook(
    ({ input }) =>
      useChatflowState({
        scope: 'conversation',
        isChatflowApp: true,
        chatflowInterface: input,
        regularInterface: input,
      }),
    { initialProps: { input: initial } }
  );
  rerender({ input: waiting });
  act(() => result.current.setShowNodeTracker(true));
  act(() => result.current.setShowNodeTracker(false));
  rerender({ input: makeInterface(Date.now() - 1000) });
  expect(result.current.showNodeTracker).toBe(false);
  rerender({ input: initial });
  rerender({ input: waiting });
  rerender({ input: makeInterface(Date.now()) });
  expect(result.current.showNodeTracker).toBe(true);
});
