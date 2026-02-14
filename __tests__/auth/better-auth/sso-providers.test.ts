/** @jest-environment node */
import {
  parseSsoProvidersFromEnv,
  toDefaultSsoConfig,
} from '@lib/auth/better-auth/sso-providers';

describe('sso provider env parser', () => {
  it('returns empty providers when env is missing', () => {
    const parsed = parseSsoProvidersFromEnv(undefined);

    expect(parsed.providers).toHaveLength(0);
    expect(parsed.warnings).toHaveLength(0);
  });

  it('parses native oidc provider with defaults', () => {
    const envValue = JSON.stringify([
      {
        providerId: 'corp-oidc',
        domain: 'example.com',
        issuer: 'https://idp.example.com/',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
    ]);

    const parsed = parseSsoProvidersFromEnv(envValue);

    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.providers).toHaveLength(1);
    expect(parsed.providers[0]?.mode).toBe('native');
    expect(parsed.providers[0]?.oidcConfig.discoveryEndpoint).toBe(
      'https://idp.example.com/.well-known/openid-configuration'
    );
    expect(parsed.providers[0]?.oidcConfig.pkce).toBe(true);
  });

  it('adds warning when cas-bridge provider misses casIssuer', () => {
    const envValue = JSON.stringify([
      {
        providerId: 'campus-cas',
        domain: 'campus.edu',
        issuer: 'https://bridge.example.com/campus',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        mode: 'cas-bridge',
      },
    ]);

    const parsed = parseSsoProvidersFromEnv(envValue);

    expect(parsed.providers[0]?.mode).toBe('cas-bridge');
    expect(parsed.warnings).toHaveLength(1);
  });

  it('converts providers to better-auth defaultSSO format', () => {
    const envValue = JSON.stringify([
      {
        providerId: 'corp-oidc',
        domain: 'example.com',
        issuer: 'https://idp.example.com',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      },
    ]);

    const parsed = parseSsoProvidersFromEnv(envValue);
    const defaultSso = toDefaultSsoConfig(parsed.providers);

    expect(defaultSso).toHaveLength(1);
    expect(defaultSso[0]).toMatchObject({
      providerId: 'corp-oidc',
      domain: 'example.com',
    });
    expect(defaultSso[0]?.oidcConfig?.issuer).toBe('https://idp.example.com');
  });

  it('throws on invalid json', () => {
    expect(() => parseSsoProvidersFromEnv('{invalid')).toThrow(
      'Invalid BETTER_AUTH_SSO_PROVIDERS_JSON'
    );
  });
});
