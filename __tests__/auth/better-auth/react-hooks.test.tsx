import { getCurrentSession } from '@lib/auth/better-auth/http-client';
import { useAuthSession } from '@lib/auth/better-auth/react-hooks';
import { act, renderHook, waitFor } from '@testing-library/react';

let mockRefresh = () => {};
jest.mock('@lib/auth/better-auth/http-client', () => ({
  getCurrentSession: jest.fn(),
  subscribeAuthStateChange: (listener: () => void) => {
    mockRefresh = listener;
    return () => {};
  },
}));

it('retains confirmed identity during loading and a transient refresh failure', async () => {
  jest
    .mocked(getCurrentSession)
    .mockResolvedValueOnce({ user: { id: 'actor' } });
  const { result } = renderHook(() => useAuthSession());
  await waitFor(() => expect(result.current.loading).toBe(false));
  let reject!: (error: Error) => void;
  jest.mocked(getCurrentSession).mockImplementationOnce(
    () =>
      new Promise((resolve, fail) => {
        reject = fail;
      })
  );
  act(() => mockRefresh());
  expect(result.current.loading).toBe(true);
  expect(result.current.user?.id).toBe('actor');
  await act(async () => {
    reject(new Error('offline'));
  });
  expect(result.current.loading).toBe(false);
  expect(result.current.session?.user.id).toBe('actor');
});
