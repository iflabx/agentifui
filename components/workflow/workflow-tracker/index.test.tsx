import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';
import type { AppExecution } from '@lib/types/database';
import { fireEvent, render, screen } from '@testing-library/react';

import { WorkflowTracker } from './index';

jest.mock('next-intl', () => ({
  useTranslations:
    (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      `${namespace}.${key}${values?.count !== undefined ? `:${values.count}` : ''}`,
}));

jest.mock('./result-viewer', () => ({
  ResultViewer: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Close result</button>
  ),
}));

const history = (
  id: string,
  metadata: Record<string, unknown>
): AppExecution => ({
  id,
  metadata,
  user_id: 'test-user',
  service_instance_id: 'test-app',
  execution_type: 'workflow',
  external_execution_id: null,
  task_id: null,
  title: id,
  inputs: {},
  outputs: { result: 'Done' },
  status: 'completed',
  error_message: null,
  total_steps: 1,
  total_tokens: 0,
  elapsed_time: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:01Z',
  completed_at: '2026-01-01T00:00:01Z',
});

describe('Workflow process integration', () => {
  beforeEach(() => {
    useWorkflowExecutionStore.getState().reset();
    useWorkflowExecutionStore.setState({
      nodes: [
        {
          id: 'live',
          title: 'Live task A',
          description: '',
          visible: true,
          status: 'running',
        },
      ],
      error: 'PRIVATE_LIVE_ERROR',
      canRetry: true,
    });
  });

  it('counts all live nodes independently of expansion without using them for history', () => {
    useWorkflowExecutionStore.setState({
      error: null,
      nodes: [
        {
          id: 'iteration',
          title: 'Iterate',
          description: '',
          visible: true,
          status: 'completed',
          isIterationNode: true,
          iterations: [
            { id: 'round', index: 0, status: 'completed', startTime: 0 },
          ],
        },
        {
          id: 'child',
          title: 'Nested step',
          description: '',
          visible: true,
          status: 'completed',
          isInIteration: true,
        },
      ],
    });
    const { rerender } = render(
      <WorkflowTracker
        isExecuting={false}
        currentExecution={null}
        executionResult={null}
      />
    );
    expect(
      screen.getByText('executionProcess.completedCount:2')
    ).toBeInTheDocument();
    expect(screen.queryByText('Nested step')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: /Iterate/ });
    fireEvent.click(toggle);
    expect(screen.getByText('Nested step')).toBeInTheDocument();
    expect(
      screen.getByText('executionProcess.completedCount:2')
    ).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.queryByText('Nested step')).not.toBeInTheDocument();
    expect(
      screen.getByText('executionProcess.completedCount:2')
    ).toBeInTheDocument();
    rerender(
      <WorkflowTracker
        historical
        isExecuting={false}
        currentExecution={history('saved', {
          node_executions: [
            { node_id: 'saved', title: 'Saved step', status: 'succeeded' },
          ],
        })}
        executionResult={null}
      />
    );
    expect(
      screen.getByText('executionProcess.completedCount:1')
    ).toBeInTheDocument();
    expect(screen.queryByText('Nested step')).not.toBeInTheDocument();
  });

  it('isolates history from live nodes, errors and execution actions', () => {
    const execution = history('task-b', {
      node_executions: [
        {
          node_id: 'saved',
          title: 'Saved task B',
          status: 'succeeded',
          inputs: 'PRIVATE_INPUT',
          error: 'PRIVATE_NODE_ERROR',
        },
      ],
    });
    const retry = jest.fn();
    const stop = jest.fn();
    const nodes = useWorkflowExecutionStore.getState().nodes;
    const { container, rerender } = render(
      <WorkflowTracker
        historical
        isExecuting
        currentExecution={execution}
        executionResult={null}
        onRetry={retry}
        onStop={stop}
      />
    );
    expect(screen.getByText('Saved task B')).toBeInTheDocument();
    expect(screen.queryByText('Live task A')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('PRIVATE');
    expect(
      screen.queryByRole('button', { name: /retry|stop/ })
    ).not.toBeInTheDocument();
    expect(useWorkflowExecutionStore.getState().nodes).toBe(nodes);
    rerender(
      <WorkflowTracker
        historical
        isExecuting={false}
        currentExecution={history('empty', {})}
        executionResult={null}
      />
    );
    expect(screen.getByText('executionProcess.empty')).toBeInTheDocument();
    expect(screen.queryByText('Saved task B')).not.toBeInTheDocument();
    expect(screen.queryByText('Live task A')).not.toBeInTheDocument();
    expect(retry).not.toHaveBeenCalled();
    expect(stop).not.toHaveBeenCalled();
  });

  it('keeps history steps after closing a result and clears the viewer on selection change', () => {
    const closeHistory = jest.fn();
    const execution = history('task-b', {
      node_executions: [
        { node_id: 'saved', title: 'Saved task B', status: 'running' },
      ],
    });
    const { rerender } = render(
      <WorkflowTracker
        historical
        isExecuting={false}
        currentExecution={execution}
        executionResult={execution.outputs}
        onCloseHistory={closeHistory}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close result' }));
    expect(screen.getByText('Saved task B')).toBeInTheDocument();
    expect(
      screen.getByText('executionProcess.status.unknown')
    ).toBeInTheDocument();
    expect(closeHistory).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'executionProcess.close' })
    );
    expect(closeHistory).toHaveBeenCalledTimes(1);
    rerender(
      <WorkflowTracker
        isExecuting={false}
        currentExecution={null}
        executionResult={null}
      />
    );
    expect(
      screen.queryByRole('button', { name: 'Close result' })
    ).not.toBeInTheDocument();
  });

  it('preserves keyboard-accessible iteration, loop and parallel details with shared rows', () => {
    useWorkflowExecutionStore.setState({
      error: null,
      nodes: [
        {
          id: 'iterate',
          title: 'Iterate',
          description: '',
          visible: true,
          status: 'completed',
          isIterationNode: true,
          iterations: [
            {
              id: 'iteration-1',
              index: 0,
              status: 'completed',
              startTime: 0,
              endTime: 10,
            },
          ],
        },
        {
          id: 'loop',
          title: 'Loop',
          description: '',
          visible: true,
          status: 'completed',
          isLoopNode: true,
          loops: [
            {
              id: 'loop-1',
              index: 0,
              status: 'failed',
              startTime: 10,
              endTime: 20,
            },
          ],
        },
        {
          id: 'parallel',
          title: 'Parallel',
          description: '',
          visible: true,
          status: 'completed',
          isParallelNode: true,
          parallelBranches: [
            {
              id: 'branch-1',
              name: 'Branch one',
              status: 'completed',
              startTime: 0,
              endTime: 40,
            },
          ],
        },
      ],
    });
    render(
      <WorkflowTracker
        isExecuting={false}
        currentExecution={null}
        executionResult={null}
      />
    );
    const iterate = screen.getByRole('button', { name: /Iterate/ });
    fireEvent.click(iterate);
    expect(iterate).toHaveAttribute('aria-expanded', 'true');
    expect(
      screen.getByText('pages.workflow.iterationDetails.roundIteration')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Loop/ }));
    expect(
      screen.getByText('pages.workflow.iterationDetails.roundLoop')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Parallel/ }));
    expect(screen.getByText('Branch one')).toBeInTheDocument();
  });
});
