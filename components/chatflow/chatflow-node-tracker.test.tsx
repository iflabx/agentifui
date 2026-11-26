import type { ChatflowNode } from '@lib/stores/chatflow-execution-store';
import { fireEvent, render, screen } from '@testing-library/react';

import { ChatflowNodeTracker } from './chatflow-node-tracker';

jest.mock('next-intl', () => ({
  useTranslations:
    (namespace: string) => (key: string, values?: Record<string, unknown>) =>
      `${namespace}.${key}${values?.count !== undefined ? `:${values.count}` : ''}`,
}));

describe('Chatflow process integration', () => {
  it('keeps the completed count stable while nested nodes are expanded and collapsed', () => {
    const nodes: ChatflowNode[] = [
      {
        id: 'iteration',
        title: 'Iterate',
        status: 'completed',
        isIterationNode: true,
        iterations: [
          { id: 'round', index: 0, status: 'completed', startTime: 0 },
        ],
      },
      {
        id: 'child',
        title: 'Nested step',
        status: 'completed',
        isInIteration: true,
      },
    ];
    render(
      <ChatflowNodeTracker
        scope="conversation"
        status="completed"
        nodes={nodes}
        open
        onOpenChange={jest.fn()}
      />
    );
    expect(
      screen.getByText('executionProcess.completedCount:2')
    ).toBeInTheDocument();
    expect(screen.queryByText('Nested step')).not.toBeInTheDocument();
    const toggle = screen.getByRole('button', {
      name: /Iterate/,
      expanded: false,
    });
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
  });

  it('uses the common process view and supports closing without executing anything', () => {
    const onOpenChange = jest.fn();
    const nodes: ChatflowNode[] = [
      {
        id: 'parallel',
        title: 'Parallel',
        isParallelNode: true,
        status: 'running',
        description: 'PRIVATE_NODE',
        parallelBranches: [
          {
            id: 'branch',
            index: 0,
            status: 'failed',
            startTime: 10,
            endTime: 40,
            description: 'PRIVATE_BRANCH',
            inputs: { secret: 'PRIVATE_INPUT' },
          },
        ],
      },
    ];
    const { rerender } = render(
      <ChatflowNodeTracker
        scope="conversation"
        status="failed"
        nodes={nodes}
        open
        onOpenChange={onOpenChange}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /Parallel/ }));
    expect(
      screen.getByText('pages.chatflow.executionBar.branch.label A')
    ).toBeInTheDocument();
    expect(screen.getAllByText('executionProcess.status.failed')).toHaveLength(
      2
    );
    expect(document.body.textContent).not.toContain('PRIVATE');
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'executionProcess.close' })
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
    rerender(
      <ChatflowNodeTracker
        scope="conversation"
        status="failed"
        nodes={nodes}
        open={false}
        onOpenChange={onOpenChange}
      />
    );
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
});
