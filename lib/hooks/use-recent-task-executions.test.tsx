import { getUserExecutions } from '@lib/services/client/app-executions-api';
import { useAppListStore } from '@lib/stores/app-list-store';
import { syncChatDraftActor } from '@lib/stores/chat-draft-lifecycle';
import type { AppExecution } from '@lib/types/database';
import { success } from '@lib/types/result';
import { act, renderHook, waitFor } from '@testing-library/react';

import { useRecentTaskExecutions } from './use-recent-task-executions';

jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => ({ loading: false }),
}));
jest.mock('@lib/services/client/app-executions-api', () => ({
  getUserExecutions: jest.fn(),
}));

function deferred<Value>() {
  let resolve!: (value: Value) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<Value>((accept, fail) => {
    resolve = accept;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const execution = {
  id: 'old-execution',
  title: 'Private task',
  inputs: {},
  status: 'completed',
  service_instance_id: 'app',
  execution_type: 'workflow',
  created_at: '2026-01-01',
  updated_at: '2026-01-01',
} as AppExecution;

beforeEach(() => {
  jest.resetAllMocks();
  syncChatDraftActor(null);
  syncChatDraftActor('first-user');
  useAppListStore.setState({
    apps: [
      {
        id: 'app',
        name: 'Example',
        instance_id: 'example',
        config: { app_metadata: { dify_apptype: 'workflow' } },
      },
    ],
  });
});

it('hides old task titles immediately on account switch and logout', async () => {
  const next = deferred<ReturnType<typeof success<AppExecution[]>>>();
  jest
    .mocked(getUserExecutions)
    .mockResolvedValueOnce(success([execution]))
    .mockReturnValueOnce(next.promise);
  const { result } = renderHook(() => useRecentTaskExecutions());
  await waitFor(() => expect(result.current.executions).toHaveLength(1));
  act(() => syncChatDraftActor('second-user'));
  expect(result.current.executions).toEqual([]);
  expect(result.current.isLoading).toBe(true);
  await act(async () => next.resolve(success([])));
  expect(result.current.executions).toEqual([]);
  expect(result.current.isLoading).toBe(false);
  act(() => syncChatDraftActor(null));
  expect(result.current.executions).toEqual([]);
});

it.each(['resolve', 'reject'] as const)(
  'ignores a late old task %s without resetting the new loading state',
  async completion => {
    const old = deferred<ReturnType<typeof success<AppExecution[]>>>();
    const next = deferred<ReturnType<typeof success<AppExecution[]>>>();
    jest
      .mocked(getUserExecutions)
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(next.promise);
    const { result } = renderHook(() => useRecentTaskExecutions());
    act(() => syncChatDraftActor('second-user'));
    await act(async () => {
      if (completion === 'resolve') old.resolve(success([execution]));
      else old.reject(new Error('Old task failure'));
    });
    expect(result.current.executions).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(true);
    await act(async () => next.resolve(success([])));
    expect(result.current.isLoading).toBe(false);
  }
);
