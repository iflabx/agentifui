import type { AgentInteraction } from '@lib/services/client/langchain-api';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { AgentInteractionCard } from './agent-interaction-card';

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const interaction: AgentInteraction = {
  id: 'local',
  originRunId: 'run',
  status: 'pending',
  title: 'Confirm',
  description: '<script>not executable</script>',
  actions: ['approve', 'reject'],
  commentMaxLength: 500,
  expiresAt: null,
};

describe('shared confirmation card', () => {
  afterEach(() => jest.useRealTimers());

  it('removes actions at the announced expiration without another chat event', async () => {
    jest.useFakeTimers();
    const expiresAt = new Date(Date.now() + 1000).toISOString();
    render(
      <AgentInteractionCard
        interaction={{ ...interaction, expiresAt }}
        disabled={false}
        uncertain={false}
        onRespond={jest.fn()}
      />
    );
    expect(
      screen.getByRole('button', { name: 'confirmationApprove' })
    ).toBeEnabled();
    await act(async () => jest.advanceTimersByTimeAsync(1000));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('confirmationExpired');
    await act(async () => jest.advanceTimersByTimeAsync(5000));
    expect(jest.getTimerCount()).toBe(0);
  });
  it('labels the input and only submits an explicit selected action', () => {
    const respond = jest.fn().mockResolvedValue(undefined);
    render(
      <AgentInteractionCard
        interaction={interaction}
        disabled={false}
        uncertain={false}
        onRespond={respond}
      />
    );
    expect(respond).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('confirmationComment'), {
      target: { value: 'my decision' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'confirmationReject' }));
    expect(respond).toHaveBeenCalledWith('local', 'reject', 'my decision');
    expect(document.querySelector('script')).toBeNull();
    expect(screen.getByText(interaction.description)).toBeInTheDocument();
  });

  it.each(['accepted', 'expired', 'submitting', 'unknown'] as const)(
    'never offers an action for %s historical state',
    status => {
      render(
        <AgentInteractionCard
          interaction={{ ...interaction, status }}
          disabled={false}
          uncertain={false}
          onRespond={jest.fn()}
        />
      );
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    }
  );

  it('does not allow an uncertain submission to be sent again', () => {
    render(
      <AgentInteractionCard
        interaction={interaction}
        disabled={false}
        uncertain={true}
        onRespond={jest.fn()}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('confirmationUnknown');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not replace an accepted decision with the original expired deadline', () => {
    render(
      <AgentInteractionCard
        interaction={{
          ...interaction,
          status: 'accepted',
          expiresAt: '2000-01-01T00:00:00Z',
          decision: { action: 'approve', comment: 'Reviewed' },
        }}
        disabled={false}
        uncertain={false}
        onRespond={jest.fn()}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      'confirmationAnswered'
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
