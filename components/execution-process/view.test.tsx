import { fireEvent, render, screen } from '@testing-library/react';

import { useState } from 'react';

import { ExecutionProcessDisclosure } from './disclosure';
import { ExecutionProcessRow } from './row';
import type { ExecutionProcessItem } from './types';
import { ExecutionProcessView } from './view';

const items: ExecutionProcessItem[] = [
  { key: 'first', title: 'Search', kind: 'tool', status: 'completed' },
  { key: 'second', title: 'Generate', kind: 'step', status: 'running' },
];

describe('shared execution process UI', () => {
  it('opens one controlled right-side panel at a time and returns focus on Escape', () => {
    function Panels() {
      const [selected, setSelected] = useState<string | null>(null);
      return (
        <>
          {['first', 'second'].map(id => (
            <ExecutionProcessDisclosure
              key={id}
              items={[{ ...items[0], title: `Activity ${id}` }]}
              placement="panel"
              title={`Task ${id}`}
              open={selected === id}
              onOpenChange={open => setSelected(open ? id : null)}
            />
          ))}
        </>
      );
    }
    const { container } = render(<Panels />);
    fireEvent.click(
      screen.getAllByRole('button', { name: 'executionProcess.view' })[0]
    );
    expect(screen.getByText('Task first')).toBeInTheDocument();
    const firstPanel = document.querySelector<HTMLDivElement>(
      '[data-execution-process-panel]'
    );
    expect(firstPanel).toHaveClass('fixed', 'right-4');
    expect(firstPanel?.parentElement).toBe(document.body);
    expect(container).not.toContainElement(firstPanel);
    fireEvent.click(
      screen.getByRole('button', { name: 'executionProcess.view' })
    );
    expect(screen.queryByText('Task first')).not.toBeInTheDocument();
    expect(screen.getByText('Task second')).toBeInTheDocument();
    expect(
      document.querySelectorAll('[data-execution-process-panel]')
    ).toHaveLength(1);
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.querySelector('[data-execution-process-panel]')).toBeNull();
    expect(
      screen.getAllByRole('button', { name: 'executionProcess.view' })[1]
    ).toHaveFocus();
  });

  it('allows a running panel to wait for its first activity', () => {
    render(
      <ExecutionProcessDisclosure items={[]} executing placement="panel" />
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'executionProcess.view' })
    );
    expect(screen.getByText('executionProcess.waiting')).toBeInTheDocument();
  });
  it('shows activities and controlled states without a fictional percentage', () => {
    const { container } = render(<ExecutionProcessView items={items} />);
    expect(
      screen.getByRole('region', { name: 'executionProcess.title' })
    ).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(
      screen.getByText('executionProcess.status.running')
    ).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    expect(container.textContent).not.toContain('%');
    expect(container.querySelector('ol')?.children).toHaveLength(2);
  });

  it('does not spin while viewing an empty saved process', () => {
    const { container, rerender } = render(
      <ExecutionProcessView items={[]} historical executing />
    );
    expect(screen.getByText('executionProcess.empty')).toBeInTheDocument();
    expect(container.querySelector('.animate-spin')).toBeNull();
    rerender(<ExecutionProcessView items={[]} executing />);
    expect(screen.getByText('executionProcess.waiting')).toBeInTheDocument();
  });

  it('does not turn completed tools into failed ones on run failure', () => {
    render(<ExecutionProcessView items={items} failed />);
    expect(
      screen.getByText('executionProcess.failedNotice')
    ).toBeInTheDocument();
    expect(
      screen.getByText('executionProcess.status.completed')
    ).toBeInTheDocument();
    expect(
      screen.queryByText('executionProcess.status.failed')
    ).not.toBeInTheDocument();
  });

  it('supports native keyboard controls for nested activities', () => {
    function Nested() {
      const [expanded, setExpanded] = useState(false);
      return (
        <ExecutionProcessRow
          item={{ ...items[0], children: [items[1]] }}
          expanded={expanded}
          onToggle={() => setExpanded(!expanded)}
        />
      );
    }
    render(<Nested />);
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Generate')).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(
      document.getElementById(button.getAttribute('aria-controls')!)
    ).toContainElement(screen.getByText('Generate'));
  });

  it('opens on demand, closes with focus return and resets on scope change', () => {
    const { rerender } = render(
      <ExecutionProcessDisclosure
        key="one"
        items={items}
        historical
        unordered
      />
    );
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole('button', { name: 'executionProcess.view' })
    );
    expect(screen.getByText('executionProcess.historical')).toBeInTheDocument();
    expect(screen.getByText('executionProcess.unordered')).toBeInTheDocument();
    const close = screen.getByRole('button', {
      name: 'executionProcess.close',
    });
    close.focus();
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(
      screen.getByRole('button', { name: 'executionProcess.view' })
    ).toHaveFocus();
    fireEvent.click(
      screen.getByRole('button', { name: 'executionProcess.view' })
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'executionProcess.close' })
    );
    expect(
      screen.getByRole('button', { name: 'executionProcess.view' })
    ).toHaveFocus();
    fireEvent.click(
      screen.getByRole('button', { name: 'executionProcess.view' })
    );
    rerender(<ExecutionProcessDisclosure key="two" items={items} />);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    rerender(<ExecutionProcessDisclosure key="two" items={[]} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
