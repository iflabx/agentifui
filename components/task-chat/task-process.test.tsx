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
      status: 'completed',
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
  expect(document.querySelector('[data-execution-process-panel]')).toHaveClass(
    'fixed',
    'md:right-4'
  );
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

it('shows missing saved workflow details only in the side panel', () => {
  const { container } = render(
    <TaskProcess
      execution={
        { id: 'old', metadata: {}, execution_type: 'workflow' } as AppExecution
      }
      live={false}
    />
  );
  expect(screen.queryByText('empty')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'view' }));
  expect(screen.getByText('empty')).toBeInTheDocument();
  expect(container).not.toContainElement(screen.getByText('empty'));
  expect(
    savedTaskNodes({ task_process_nodes: [{ ...saved, iterations: [null] }] })
  ).toEqual([]);
});

it('does not display a concurrent Workflow process in a text generation task', () => {
  useWorkflowExecutionStore.setState({
    nodes: [
      {
        id: 'workflow-step',
        title: 'Unrelated Workflow step',
        description: '',
        status: 'running',
        visible: true,
      },
    ],
  });
  render(
    <TaskProcess
      execution={
        {
          id: 'textgen',
          metadata: {},
          execution_type: 'text-generation',
          status: 'running',
        } as AppExecution
      }
      live
    />
  );
  expect(screen.getByText('status.running')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'view' })
  ).not.toBeInTheDocument();
  expect(screen.queryByText('Unrelated Workflow step')).not.toBeInTheDocument();
});
