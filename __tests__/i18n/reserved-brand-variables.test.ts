/**
 * @jest-environment node
 */
import {
  getBrandVariableMap,
  getProtectedTerms,
  resolveReservedVariablesDeep,
} from '@lib/config/branding';

describe('reserved brand variables', () => {
  const originalName = process.env.NEXT_PUBLIC_BRAND_NAME;
  const originalDomain = process.env.NEXT_PUBLIC_BRAND_DOMAIN;
  const commonJsBranding = jest.requireActual('../../lib/config/branding.js');

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_BRAND_NAME;
    delete process.env.NEXT_PUBLIC_BRAND_DOMAIN;
  });

  afterEach(() => {
    if (originalName === undefined) delete process.env.NEXT_PUBLIC_BRAND_NAME;
    else process.env.NEXT_PUBLIC_BRAND_NAME = originalName;
    if (originalDomain === undefined)
      delete process.env.NEXT_PUBLIC_BRAND_DOMAIN;
    else process.env.NEXT_PUBLIC_BRAND_DOMAIN = originalDomain;
  });

  it('replaces only reserved variables inside message objects', () => {
    const now = new Date('2026-03-30T00:00:00.000Z');
    const messages = {
      dynamicTitle: {
        base: '{productName}',
        mixed: 'Start with {appName} on {productName}',
      },
      footer: {
        copyright: '© {year} {projectName}',
      },
      list: ['Visit {publicDomain}', 'Keep {count} placeholders'],
    };

    const resolved = resolveReservedVariablesDeep(messages, 'en-US', now);

    expect(resolved).toEqual({
      dynamicTitle: {
        base: 'AgentifUI',
        mixed: 'Start with {appName} on AgentifUI',
      },
      footer: {
        copyright: '© 2026 AgentifUI',
      },
      list: ['Visit example.com', 'Keep {count} placeholders'],
    });
  });

  it.each(['en-US', 'zh-CN'])(
    'uses public defaults for %s in Web and API',
    locale => {
      const now = new Date('2026-03-30T00:00:00.000Z');
      const expected = {
        productName: 'AgentifUI',
        projectName: 'AgentifUI',
        publicDomain: 'example.com',
        year: '2026',
      };

      expect(getBrandVariableMap(locale, now)).toEqual(expected);
      expect(commonJsBranding.getBrandVariableMap(locale, now)).toEqual(
        expected
      );
    }
  );

  it('uses explicit deployment branding without changing application origins', () => {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    const authUrl = process.env.BETTER_AUTH_URL;
    const cors = process.env.CORS_ALLOWED_ORIGINS;
    process.env.NEXT_PUBLIC_BRAND_NAME = '  Example Assistant  ';
    process.env.NEXT_PUBLIC_BRAND_DOMAIN = '  stage.example:18021  ';
    const now = new Date('2026-03-30T00:00:00.000Z');
    const expected = {
      productName: 'Example Assistant',
      projectName: 'AgentifUI',
      publicDomain: 'stage.example:18021',
      year: '2026',
    };

    expect(getBrandVariableMap('en-US', now)).toEqual(expected);
    expect(commonJsBranding.getBrandVariableMap('en-US', now)).toEqual(
      expected
    );
    expect(
      resolveReservedVariablesDeep('{productName} on {publicDomain}', 'en-US')
    ).toBe('Example Assistant on stage.example:18021');
    expect(
      commonJsBranding.resolveReservedVariablesDeep(
        '{productName} on {publicDomain}',
        'en-US'
      )
    ).toBe('Example Assistant on stage.example:18021');
    for (const locale of [undefined, 'en-US', 'zh-CN']) {
      expect(getProtectedTerms(locale)).toEqual(
        expect.arrayContaining([
          'AgentifUI',
          'Example Assistant',
          'stage.example:18021',
        ])
      );
      expect(commonJsBranding.getProtectedTerms(locale)).toEqual(
        getProtectedTerms(locale)
      );
    }
    expect(process.env.NEXT_PUBLIC_APP_URL).toBe(appUrl);
    expect(process.env.BETTER_AUTH_URL).toBe(authUrl);
    expect(process.env.CORS_ALLOWED_ORIGINS).toBe(cors);
  });

  it.each(['', '   '])('falls back when an override is blank (%j)', value => {
    process.env.NEXT_PUBLIC_BRAND_NAME = value;
    process.env.NEXT_PUBLIC_BRAND_DOMAIN = value;

    expect(getBrandVariableMap('en-US')).toMatchObject({
      productName: 'AgentifUI',
      publicDomain: 'example.com',
    });
    expect(commonJsBranding.getBrandVariableMap('en-US')).toEqual(
      getBrandVariableMap('en-US')
    );
  });
});
