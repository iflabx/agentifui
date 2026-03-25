/** @jest-environment node */
import {
  formatDuration,
  getBarStyles,
  getCounterBadgeText,
  getNodeTitle,
  getParallelBranchLabel,
  getStatusText,
  isExpandableNode,
  shouldShowExpandedParallelBranches,
} from '@components/chatflow/chatflow-execution-bar/helpers';

describe('chatflow execution bar helpers', () => {
  const t = (key: string) => key;

  it('formats durations and branch labels', () => {
    expect(formatDuration(250)).toBe('250ms');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(getParallelBranchLabel(0)).toBe('A');
    expect(getParallelBranchLabel(2)).toBe('C');
  });

  it('resolves node titles, statuses and counters', () => {
    expect(getNodeTitle({ type: 'llm', title: '' } as never, 0, t)).toBe(
      'nodeTypes.llm'
    );
    expect(getNodeTitle({ type: 'unknown', title: '' } as never, 1, t)).toBe(
      'nodeTypes.node 2'
    );
    expect(
      getStatusText({ status: 'running', isLoopNode: true } as never, t)
    ).toBe('status.looping');
    expect(
      getCounterBadgeText({
        isParallelNode: true,
        completedBranches: 1,
        totalBranches: 3,
      } as never)
    ).toBe('1/3');
  });

  it('detects expandable and expanded parallel nodes', () => {
    expect(isExpandableNode({ isIterationNode: true } as never)).toBe(true);
    expect(isExpandableNode({} as never)).toBe(false);
    expect(
      shouldShowExpandedParallelBranches(
        { isParallelNode: true, parallelBranches: [{ id: 'b1' }] } as never,
        true
      )
    ).toBe(true);
    expect(
      getBarStyles({ status: 'failed', isInLoop: true } as never, true)
    ).toContain('border-red-200');
  });
});
