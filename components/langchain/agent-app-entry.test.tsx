import { act, render, screen, waitFor } from '@testing-library/react';

import { AgentAppEntry } from './agent-app-entry';

jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => ({
    session: { user: { id: 'actor' } },
    loading: false,
  }),
}));
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('./agent-chat', () => ({
  AgentChat: ({ appId }: { appId: string }) => <p>shared:{appId}</p>,
}));
const originalFetch = global.fetch;
const metadata = { app_type: 'marketplace', dify_apptype: 'chatbot' };
afterEach(() => {
  global.fetch = originalFetch;
});

it.each([true, false])(
  'selects the current authorized config before mounting a controller (opted in: %s)',
  async selected => {
    let resolve!: (response: unknown) => void;
    global.fetch = jest.fn().mockReturnValue(
      new Promise(done => {
        resolve = done;
      })
    );
    const legacyMounted = jest.fn();
    function Legacy() {
      legacyMounted();
      return <p>legacy</p>;
    }
    render(
      <AgentAppEntry instanceId="slug">
        <Legacy />
      </AgentAppEntry>
    );
    expect(legacyMounted).not.toHaveBeenCalled();
    await act(async () => {
      resolve({
        ok: true,
        json: async () => ({
          success: true,
          apps: [
            {
              id: 'local-app',
              instance_id: 'slug',
              config: {
                backend_type: 'dify',
                app_metadata: metadata,
                ...(selected ? { interaction_protocol: 'ag-ui/1.0' } : {}),
              },
            },
          ],
        }),
      });
    });
    await waitFor(() =>
      expect(
        screen.getByText(selected ? 'shared:local-app' : 'legacy')
      ).toBeInTheDocument()
    );
    expect(legacyMounted).toHaveBeenCalledTimes(selected ? 0 : 1);
  }
);

it('does not mount a legacy controller after an authorization lookup failure', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: false });
  render(
    <AgentAppEntry instanceId="slug">
      <p>legacy</p>
    </AgentAppEntry>
  );
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent('unavailable')
  );
  expect(screen.queryByText('legacy')).not.toBeInTheDocument();
});
