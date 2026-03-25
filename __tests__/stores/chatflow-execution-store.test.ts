/** @jest-environment node */
import { useChatflowExecutionStore } from '@lib/stores/chatflow-execution-store';

describe('chatflow execution store', () => {
  beforeEach(() => {
    useChatflowExecutionStore.setState({
      ...useChatflowExecutionStore.getInitialState(),
    });
  });

  it('marks running nodes failed when execution stops', () => {
    const store = useChatflowExecutionStore.getState();

    store.startExecution();
    store.addNode({
      id: 'node-1',
      title: 'Node 1',
      status: 'running',
      startTime: Date.now(),
      description: 'Running...',
    });

    store.stopExecution();

    const next = useChatflowExecutionStore.getState();
    expect(next.isExecuting).toBe(false);
    expect(next.canRetry).toBe(true);
    expect(next.nodes[0]?.status).toBe('failed');
    expect(next.nodes[0]?.endTime).toBeDefined();
  });

  it('marks child nodes inside iterations', () => {
    const store = useChatflowExecutionStore.getState();

    store.handleNodeEvent({
      event: 'iteration_started',
      data: {
        node_id: 'iter-root',
        iteration_id: 'iter-1',
        iteration_index: 0,
        total_iterations: 3,
        title: 'Iteration Root',
        node_type: 'iteration',
      },
    });

    store.handleNodeEvent({
      event: 'node_started',
      data: {
        node_id: 'child-1',
        node_type: 'llm',
        title: 'Child Node',
      },
    });

    const next = useChatflowExecutionStore.getState();
    const child = next.nodes.find(node => node.id === 'child-1');

    expect(next.currentIteration?.nodeId).toBe('iter-root');
    expect(next.iterationExpandedStates['iter-root']).toBe(true);
    expect(child?.isInIteration).toBe(true);
    expect(child?.iterationIndex).toBe(0);
    expect(child?.status).toBe('running');
  });

  it('tracks loop progression and completion', () => {
    const store = useChatflowExecutionStore.getState();

    store.handleNodeEvent({
      event: 'loop_started',
      data: {
        id: 'loop-1',
        node_id: 'loop-root',
        title: 'Loop Root',
        node_type: 'loop',
        inputs: { loop_count: 2 },
      },
    });

    store.handleNodeEvent({
      event: 'loop_next',
      data: {
        node_id: 'loop-root',
        index: 1,
      },
    });

    store.handleNodeEvent({
      event: 'loop_completed',
      data: {
        node_id: 'loop-root',
        outputs: { loop_round: 2 },
      },
    });

    const next = useChatflowExecutionStore.getState();
    const loopNode = next.nodes.find(node => node.id === 'loop-root');

    expect(next.currentLoop).toBeNull();
    expect(loopNode?.status).toBe('completed');
    expect(loopNode?.totalLoops).toBe(2);
    expect(loopNode?.description).toContain('executed 2 times');
  });

  it('updates parallel branch completion counters', () => {
    const store = useChatflowExecutionStore.getState();

    store.addNode({
      id: 'parallel-root',
      title: 'Parallel Root',
      status: 'running',
      startTime: Date.now(),
      description: 'Running...',
      totalBranches: 1,
      parallelBranches: [],
    });

    store.handleNodeEvent({
      event: 'parallel_branch_started',
      data: {
        node_id: 'parallel-root',
        branch_id: 'branch-1',
        branch_index: 1,
        total_branches: 1,
      },
    });

    store.handleNodeEvent({
      event: 'parallel_branch_finished',
      data: {
        node_id: 'parallel-root',
        branch_id: 'branch-1',
        status: 'succeeded',
      },
    });

    const next = useChatflowExecutionStore.getState();
    const parallelNode = next.nodes.find(node => node.id === 'parallel-root');

    expect(parallelNode?.completedBranches).toBe(1);
    expect(parallelNode?.status).toBe('completed');
  });
});
