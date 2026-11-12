/** @jest-environment node */
import { getSocialProviders } from '@lib/auth/better-auth/server/social-providers';

describe('built-in GitHub provider configuration', () => {
  const originalId = process.env.GITHUB_CLIENT_ID;
  const originalSecret = process.env.GITHUB_CLIENT_SECRET;

  beforeEach(() => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
  });

  afterEach(() => {
    if (originalId === undefined) delete process.env.GITHUB_CLIENT_ID;
    else process.env.GITHUB_CLIENT_ID = originalId;
    if (originalSecret === undefined) delete process.env.GITHUB_CLIENT_SECRET;
    else process.env.GITHUB_CLIENT_SECRET = originalSecret;
  });

  it('does not register a provider without credentials', () => {
    expect(getSocialProviders()).toEqual({});
  });

  it.each(['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET'])(
    'does not register a partially configured provider with only %s',
    key => {
      process.env[key] = 'test-only-placeholder';
      expect(getSocialProviders()).toEqual({});
    }
  );

  it('registers the built-in provider with trimmed private credentials', () => {
    process.env.GITHUB_CLIENT_ID = ' example-client-id ';
    process.env.GITHUB_CLIENT_SECRET = ' example-client-secret ';
    expect(getSocialProviders()).toEqual({
      github: {
        clientId: 'example-client-id',
        clientSecret: 'example-client-secret',
      },
    });
  });

  it('does not register whitespace-only credentials', () => {
    process.env.GITHUB_CLIENT_ID = 'example-client-id';
    process.env.GITHUB_CLIENT_SECRET = '   ';
    expect(getSocialProviders()).toEqual({});
  });
});
