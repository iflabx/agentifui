import { render } from '@testing-library/react';

import {
  highlightMessageText,
  rehypeHighlightMessage,
} from './message-text-highlight';

it('marks only the first literal case-insensitive match and preserves the text', () => {
  const content = 'Before [A] and [a] after';
  const { container } = render(<p>{highlightMessageText(content, '[a]')}</p>);

  expect(container.querySelectorAll('mark')).toHaveLength(1);
  expect(container.querySelector('mark')).toHaveTextContent('[A]');
  expect(container.textContent).toBe(content);
});

it('preserves formatting and code blocks when highlighting a rendered reply', () => {
  const code = {
    type: 'element' as const,
    tagName: 'pre',
    properties: {},
    children: [{ type: 'text' as const, value: 'Term in code' }],
  };
  const tree: Parameters<ReturnType<typeof rehypeHighlightMessage>>[0] = {
    type: 'root',
    children: [
      code,
      {
        type: 'element',
        tagName: 'p',
        properties: {},
        children: [
          {
            type: 'element',
            tagName: 'strong',
            properties: {},
            children: [{ type: 'text', value: 'Visible term here' }],
          },
        ],
      },
    ],
  };

  rehypeHighlightMessage('TERM')(tree);
  expect(tree.children[0]).toEqual({
    ...code,
    children: [{ type: 'text', value: 'Term in code' }],
  });
  expect(tree.children[1]).toMatchObject({
    tagName: 'p',
    children: [
      {
        tagName: 'strong',
        children: [
          { type: 'text', value: 'Visible ' },
          { tagName: 'mark', children: [{ type: 'text', value: 'term' }] },
          { type: 'text', value: ' here' },
        ],
      },
    ],
  });
});
