import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TaskActions } from './task-actions';

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('@lib/hooks/use-mobile', () => ({ useMobile: () => false }));

it('focuses reuse when the menu opens and returns focus on Escape without submitting', async () => {
  const reuse = jest.fn();
  render(<TaskActions disabled={false} onReuse={reuse} />);
  const trigger = screen.getByRole('button', { name: 'ariaLabel' });
  trigger.focus();
  fireEvent.click(trigger);
  const item = await screen.findByRole('button', { name: 'runAgain' });
  expect(item).toHaveFocus();
  fireEvent.keyDown(item, { key: 'Escape' });
  expect(
    screen.queryByRole('button', { name: 'runAgain' })
  ).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(reuse).not.toHaveBeenCalled();
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('button', { name: 'runAgain' }));
  await waitFor(() => expect(reuse).toHaveBeenCalledTimes(1));
});

it('does not expose reuse while the task is busy', () => {
  render(<TaskActions disabled onReuse={jest.fn()} />);
  expect(screen.getByRole('button', { name: 'ariaLabel' })).toBeDisabled();
  expect(
    screen.queryByRole('button', { name: 'runAgain' })
  ).not.toBeInTheDocument();
});
