import {
  resolveContentVariables,
  resolveContentVariablesDeep,
} from './text-processing';

describe('content variable resolution', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-30T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('resolves reserved variables and preserves non-reserved placeholders', () => {
    expect(
      resolveContentVariables(
        'Welcome to {productName} on {publicDomain} with {appName}',
        'en-US'
      )
    ).toBe('Welcome to AgentifUI on example.com with {appName}');
  });

  it('resolves only whitelisted display text fields in nested CMS data', () => {
    const resolved = resolveContentVariablesDeep(
      {
        id: '{productName}',
        props: {
          content: 'About {productName}',
          url: 'https://{publicDomain}',
          items: [
            {
              title: 'Built on {projectName}',
              description: '© {year}',
            },
          ],
          secondaryButton: {
            text: 'Visit {publicDomain}',
          },
          alt: 'Logo {productName}',
        },
      },
      'en-US'
    );

    expect(resolved).toEqual({
      id: '{productName}',
      props: {
        content: 'About AgentifUI',
        url: 'https://{publicDomain}',
        items: [
          {
            title: 'Built on AgentifUI',
            description: '© 2026',
          },
        ],
        secondaryButton: {
          text: 'Visit example.com',
        },
        alt: 'Logo AgentifUI',
      },
    });
  });
});
