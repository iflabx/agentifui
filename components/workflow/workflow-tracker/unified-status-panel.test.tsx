import { fireEvent, render, screen } from '@testing-library/react';

import { UnifiedStatusPanel } from './unified-status-panel';

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

it('does not advertise a cancellable operation when no effective stop action exists', () => {
  const props = {
    isExecuting: true,
    progress: 0,
    error: null,
    canRetry: false,
    currentExecution: null,
    onRetry: jest.fn(),
    onReset: jest.fn(),
    onShowResult: jest.fn(),
  };
  const { rerender } = render(<UnifiedStatusPanel {...props} />);
  expect(
    screen.queryByRole('button', { name: 'stop' })
  ).not.toBeInTheDocument();
  const stop = jest.fn();
  rerender(<UnifiedStatusPanel {...props} onStop={stop} />);
  fireEvent.click(screen.getByRole('button', { name: 'stop' }));
  expect(stop).toHaveBeenCalledTimes(1);
});
