import { render, screen } from '@testing-library/react';

import ComponentRenderer from './component-renderer';

describe('ComponentRenderer', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-03-30T00:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders reserved variables inside heading, paragraph and button props', () => {
    const { rerender } = render(
      <ComponentRenderer
        component={{
          id: 'heading-1',
          type: 'heading',
          props: {
            content: 'About {productName}',
            level: 1,
            textAlign: 'center',
          },
        }}
      />
    );

    expect(
      screen.getByRole('heading', { level: 1, name: 'About BistuCopilot' })
    ).toBeInTheDocument();

    rerender(
      <ComponentRenderer
        component={{
          id: 'paragraph-1',
          type: 'paragraph',
          props: {
            content: '© {year} {projectName}',
            textAlign: 'center',
          },
        }}
      />
    );

    expect(screen.getByText('© 2026 AgentifUI')).toBeInTheDocument();

    rerender(
      <ComponentRenderer
        component={{
          id: 'button-1',
          type: 'button',
          props: {
            text: 'Open {productName}',
            variant: 'solid',
            action: 'link',
            url: '/chat',
            secondaryButton: {
              text: 'Visit {publicDomain}',
              variant: 'outline',
              action: 'link',
              url: '/about',
            },
          },
        }}
      />
    );

    expect(
      screen.getByRole('link', { name: 'Open BistuCopilot' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Visit chat.bistu.edu.cn' })
    ).toBeInTheDocument();
  });

  it('renders reserved variables inside cards and image props', () => {
    const { rerender } = render(
      <ComponentRenderer
        component={{
          id: 'cards-1',
          type: 'cards',
          props: {
            layout: 'grid',
            items: [
              {
                title: 'Built on {projectName}',
                description: 'Use {productName}',
              },
            ],
          },
        }}
      />
    );

    expect(screen.getByText('Built on AgentifUI')).toBeInTheDocument();
    expect(screen.getByText('Use BistuCopilot')).toBeInTheDocument();

    rerender(
      <ComponentRenderer
        component={{
          id: 'image-1',
          type: 'image',
          props: {
            src: '/logo.png',
            alt: 'Logo {productName}',
            caption: 'Visit {publicDomain}',
            alignment: 'center',
          },
        }}
      />
    );

    expect(screen.getByAltText('Logo BistuCopilot')).toBeInTheDocument();
    expect(screen.getByText('Visit chat.bistu.edu.cn')).toBeInTheDocument();
  });
});
