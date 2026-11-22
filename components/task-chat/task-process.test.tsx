import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';
import type { AppExecution } from '@lib/types/database';
import { fireEvent, render, screen } from '@testing-library/react';

import { TaskProcess, savedTaskNodes } from './task-process';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const saved = {
  id: 'iteration',
  title: 'Saved process',
  description: '',
  status: 'running',
  type: 'iteration',
  isIterationNode: true,
  iterations: [{ id: 'round-1', index: 0, status: 'running' }],
};

beforeEach(() => {
  useWorkflowExecutionStore.getState().clearAll();
});

it('restores each round hierarchy without borrowing live nodes or showing historical spinners', () => {
  const execution = (id: string): AppExecution =>
    ({
      id,
      metadata: { task_process_nodes: [saved] },
    }) as unknown as AppExecution;
  useWorkflowExecutionStore.setState({
    nodes: [
      {
        id: 'live',
        title: 'Unrelated live process',
        description: '',
        status: 'running',
        visible: true,
      },
    ],
  });
  render(
    <>
      <TaskProcess execution={execution('one')} live={false} />
      <TaskProcess execution={execution('two')} live={false} />
    </>
  );
  fireEvent.click(screen.getAllByRole('button', { name: 'view' })[0]);
  expect(screen.queryByText('Unrelated live process')).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole('button', { name: /iteration.*status.unknown/ })
  );
  expect(screen.getByText('roundIteration')).toBeInTheDocument();
  expect(screen.getAllByText('status.unknown')).toHaveLength(2);
  expect(document.querySelector('.animate-spin')).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'view' })[0]);
  expect(screen.getAllByText('roundIteration')).toHaveLength(1);
});

it('shows an explicit absence of saved process rather than unrelated live data', () => {
  render(
    <TaskProcess
      execution={{ id: 'old', metadata: {} } as AppExecution}
      live={false}
    />
  );
  expect(screen.getByText('noProcess')).toBeInTheDocument();
  expect(
    savedTaskNodes({ task_process_nodes: [{ ...saved, iterations: [null] }] })
  ).toEqual([]);
});
