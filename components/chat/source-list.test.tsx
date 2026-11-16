import { act, fireEvent, render, screen } from '@testing-library/react';

import { ReferenceSources } from './reference-sources';
import { SourceListItem } from './source-list';

const fullContent = 'A'.repeat(110) + '\nFull evidence';
const resource = {
  dataset_name: 'Original dataset',
  document_name: 'Original document',
  content: fullContent,
  score: 0.875,
  position: 1,
  word_count: 123,
  page: 7,
};

it('renders and copies a neutral source without adding backend fields or links', () => {
  const onCopy = jest.fn();
  render(
    <SourceListItem
      title="Evidence title"
      excerpt={'Evidence excerpt\nSecond line'}
      copyLabel="Copy evidence"
      onCopy={onCopy}
    />
  );
  expect(screen.getByText('Evidence title')).toBeInTheDocument();
  expect(screen.getByText(/Evidence excerpt/)).toHaveTextContent('Second line');
  fireEvent.click(screen.getByRole('button', { name: 'Copy evidence' }));
  expect(onCopy).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  expect(screen.queryByText(/dataset|%|Page/)).not.toBeInTheDocument();
});

it('preserves Dify metadata, list/item expansion and full-content copy feedback', async () => {
  jest.useFakeTimers();
  try {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const view = render(<ReferenceSources retrieverResources={[resource]} />);
    expect(screen.queryByText('Original document')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(
      screen.getByRole('heading', { name: 'Original document' })
    ).toBeInTheDocument();
    expect(screen.getAllByText('Original dataset')).toHaveLength(2);
    expect(screen.getByText('87.5%')).toBeInTheDocument();
    expect(
      screen.getByText('components.chat.referenceSources.wordCount')
    ).toBeInTheDocument();
    expect(
      screen.getByText('components.chat.referenceSources.page')
    ).toBeInTheDocument();
    expect(screen.getByText('A'.repeat(100) + '...')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'components.chat.referenceSources.copy',
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith(fullContent);
    expect(
      screen.getByRole('button', {
        name: 'components.chat.referenceSources.copied',
      })
    ).toBeInTheDocument();
    await act(async () => {
      jest.advanceTimersByTime(2000);
    });
    expect(
      screen.getByRole('button', {
        name: 'components.chat.referenceSources.copy',
      })
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: 'components.chat.referenceSources.expand',
      })
    );
    expect(
      view.container.querySelector('.whitespace-pre-wrap')
    ).toHaveTextContent('Full evidence');
    fireEvent.click(
      screen.getByRole('button', {
        name: 'components.chat.referenceSources.collapse',
      })
    );
    expect(screen.getByText('A'.repeat(100) + '...')).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', {
        name: /components.chat.referenceSources.title/,
      })
    );
    expect(screen.queryByText('Original document')).not.toBeInTheDocument();
  } finally {
    jest.useRealTimers();
  }
});

it('does not render Dify sources when the list is absent or empty', () => {
  const view = render(<ReferenceSources />);
  expect(view.container).toBeEmptyDOMElement();
  view.rerender(<ReferenceSources retrieverResources={[]} />);
  expect(view.container).toBeEmptyDOMElement();
});
