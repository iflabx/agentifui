/** @jest-environment node */
import { sso } from '@better-auth/sso';
import { betterAuth } from 'better-auth';

jest.mock('@better-auth/sso', () => ({
  sso: jest.fn(() => ({ id: 'sso' })),
}));
jest.mock('better-auth', () => ({
  betterAuth: jest.fn(options => options),
}));
jest.mock('better-auth/next-js', () => ({
  nextCookies: () => ({ id: 'next-cookies' }),
}));
jest.mock('better-auth/plugins/generic-oauth', () => ({
  genericOAuth: jest.fn(),
}));
jest.mock('better-auth/plugins/phone-number', () => ({
  phoneNumber: jest.fn(),
}));
jest.mock('@lib/auth/better-auth/password-reset', () => ({
  sendResetPasswordEmail: jest.fn(),
}));
jest.mock('@lib/auth/better-auth/email', () => ({
  sendVerificationEmail: jest.fn(),
}));
jest.mock('@lib/auth/better-auth/phone-otp', () => ({
  getPhoneNumberPluginOptions: jest.fn(),
}));
jest.mock('@lib/auth/better-auth/server/config', () => ({
  getAuthRateLimitConfig: () => ({}),
  getAuthSecondaryStorage: () => undefined,
  getAuthSessionConfig: () => ({}),
}));
jest.mock('@lib/auth/better-auth/server/database', () => ({
  getAuthDatabaseConfig: () => ({}),
}));
jest.mock('@lib/auth/better-auth/server/social-providers', () => ({
  getSocialProviders: () => ({
    github: {
      clientId: 'example-client-id',
      clientSecret: 'example-client-secret',
    },
  }),
}));
jest.mock('@lib/auth/better-auth/server/env', () => ({
  getBaseUrl: () => 'https://app.example.com',
  getSecret: () => 'test-only-not-a-production-secret',
  getTrustedOrigins: () => ['https://app.example.com'],
  isPhoneNumberAuthEnabled: () => false,
}));
jest.mock('@lib/auth/better-auth/server/providers', () => ({
  getAuthProviderIssuer: jest.fn(),
  getGenericOAuthProviders: () => [],
  getPublicSsoProviders: () => [],
  getSsoPluginConfig: () => [
    { providerId: 'configured-provider', domain: 'example.com' },
  ],
}));

describe('native SSO registration security', () => {
  let authOptions: Record<string, unknown>;
  let ssoOptions: Record<string, unknown>;

  beforeAll(async () => {
    await import('@lib/auth/better-auth/server');
    authOptions = (betterAuth as jest.Mock).mock.calls[0][0];
    ssoOptions = (sso as jest.Mock).mock.calls[0][0];
  });

  it('disables public provider registration and direct registration capability', () => {
    expect(authOptions).toEqual(
      expect.objectContaining({ disabledPaths: ['/sso/register'] })
    );
    expect(ssoOptions).toEqual(expect.objectContaining({ providersLimit: 0 }));
  });

  it('registers GitHub on the built-in social sign-in configuration', () => {
    expect(authOptions.socialProviders).toEqual({
      github: {
        clientId: 'example-client-id',
        clientSecret: 'example-client-secret',
      },
    });
  });

  it('preserves configured SSO providers and strict account linking', () => {
    expect(ssoOptions).toEqual(
      expect.objectContaining({
        defaultSSO: [
          { providerId: 'configured-provider', domain: 'example.com' },
        ],
      })
    );
    expect(authOptions).toEqual(
      expect.objectContaining({
        account: expect.objectContaining({
          accountLinking: {
            enabled: false,
            disableImplicitLinking: true,
          },
        }),
      })
    );
  });

  it('wires registration and reset emails without enforcing verification on existing logins', async () => {
    const { sendVerificationEmail } =
      await import('@lib/auth/better-auth/email');
    const { sendResetPasswordEmail } =
      await import('@lib/auth/better-auth/password-reset');
    expect(authOptions.emailVerification).toEqual({
      sendVerificationEmail,
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
    });
    expect(authOptions.emailAndPassword).toEqual({
      enabled: true,
      sendResetPassword: sendResetPasswordEmail,
      revokeSessionsOnPasswordReset: true,
    });
  });
});

describe('deployment email policy', () => {
  const originalDisabled = process.env.AUTH_EMAIL_DISABLED;

  afterEach(() => {
    if (originalDisabled === undefined) delete process.env.AUTH_EMAIL_DISABLED;
    else process.env.AUTH_EMAIL_DISABLED = originalDisabled;
  });

  it.each([undefined, '0', '1'])(
    'restricts email routes only when AUTH_EMAIL_DISABLED is 1, not %s',
    async value => {
      if (value === undefined) delete process.env.AUTH_EMAIL_DISABLED;
      else process.env.AUTH_EMAIL_DISABLED = value;
      await jest.isolateModulesAsync(async () => {
        const { auth } = await import('@lib/auth/better-auth/server');
        const options = auth as unknown as Record<string, unknown>;
        expect(options.disabledPaths).toEqual([
          '/sso/register',
          ...(value === '1'
            ? [
                '/sign-up/email',
                '/request-password-reset',
                '/forget-password',
                '/reset-password',
                '/send-verification-email',
                '/verify-email',
              ]
            : []),
        ]);
        expect(options.emailVerification).toMatchObject({
          sendOnSignUp: value !== '1',
        });
        expect(options.emailAndPassword).toMatchObject({ enabled: true });
        expect(options.socialProviders).toHaveProperty('github');
      });
    }
  );
});
