/** @jest-environment node */
import { resolveTrustedSessionUser } from '@lib/auth/better-auth/session-identity/account-provider';
import { inferProvider } from '@lib/auth/better-auth/session-identity/helpers';
import { runWithPgSystemContext } from '@lib/server/pg/user-context';

jest.mock('@lib/server/pg/user-context', () => ({
  runWithPgSystemContext: jest.fn(),
}));
jest.mock('@lib/auth/better-auth/server', () => ({
  getAuthProviderIssuer: jest.fn(),
}));

describe('trusted account provider', () => {
  it.each([
    [['credential'], 'better-auth'],
    [['oidc-provider'], 'oidc-provider'],
    [['oidc-provider', 'credential'], 'oidc-provider'],
    [['managed-cas:provider', 'credential'], 'managed-cas:provider'],
    [[], 'unknown'],
    [['provider-a', 'provider-b'], 'external'],
  ])(
    'derives the provider from account bindings %j',
    async (providers, expected) => {
      const query = jest.fn().mockResolvedValue({
        rows: (providers as string[]).map(provider_id => ({ provider_id })),
      });
      jest
        .mocked(runWithPgSystemContext)
        .mockImplementation(async operation => operation({ query } as never));
      const result = await resolveTrustedSessionUser({
        id: 'auth-user',
        app_metadata: { provider: 'better-auth' },
      });
      expect(result.success).toBe(true);
      if (!result.success) throw result.error;
      expect(inferProvider(result.data)).toBe(expected);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining('FROM auth_accounts'),
        ['auth-user']
      );
    }
  );

  it('fails closed when account binding lookup fails', async () => {
    jest
      .mocked(runWithPgSystemContext)
      .mockRejectedValueOnce(new Error('database unavailable'));
    const result = await resolveTrustedSessionUser({ id: 'auth-user' });
    expect(result.success).toBe(false);
  });
});
