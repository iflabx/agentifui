jest.mock('@next/bundle-analyzer', () => ({
  __esModule: true,
  default: () => (config: unknown) => config,
}));

jest.mock('next-intl/plugin', () => ({
  __esModule: true,
  default: () => (config: unknown) => config,
}));

describe('next.config security headers', () => {
  it('applies global security headers', async () => {
    const imported = await import('./next.config');
    const config = imported.default;

    expect(config.headers).toBeDefined();

    const rules = await config.headers?.();
    expect(rules).toBeDefined();
    expect(rules).toHaveLength(1);

    const headers = rules?.[0]?.headers || [];
    expect(headers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'X-Frame-Options',
          value: 'DENY',
        }),
        expect.objectContaining({
          key: 'X-Content-Type-Options',
          value: 'nosniff',
        }),
        expect.objectContaining({
          key: 'Referrer-Policy',
          value: 'strict-origin-when-cross-origin',
        }),
        expect.objectContaining({
          key: 'Content-Security-Policy',
        }),
      ])
    );
  });
});
