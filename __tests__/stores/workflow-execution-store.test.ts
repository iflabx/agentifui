/** @jest-environment node */
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';

describe('workflow execution store', () => {
  beforeEach(() => {
    useWorkflowExecutionStore.getState().clearAll();
  });

  it('stops running nodes and unlocks form on stopExecution', () => {
    const store = useWorkflowExecutionStore.getState();

    store.startExecution({ foo: 'bar' });
    store.addNode({
      id: 'node-1',
      title: 'Node 1',
      status: 'running',
      description: 'running',
      visible: true,
      startTime: Date.now(),
    });

    useWorkflowExecutionStore.getState().stopExecution();
    const next = useWorkflowExecutionStore.getState();

    expect(next.isExecuting).toBe(false);
    expect(next.formLocked).toBe(false);
    expect(next.nodes[0]?.status).toBe('failed');
    expect(next.nodes[0]?.error).toBe('Stopped by user');
  });

  it('marks child node as iteration child after iteration_started', () => {
    const store = useWorkflowExecutionStore.getState();

    store.handleNodeEvent({
      event: 'iteration_started',
      data: {
        node_id: 'iter-root',
        iteration_id: 'iter-1',
        iteration_index: 0,
        total_iterations: 3,
        title: 'Loop Root',
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

    const next = useWorkflowExecutionStore.getState();
    const child = next.nodes.find(node => node.id === 'child-1');

    expect(next.currentIteration?.nodeId).toBe('iter-root');
    expect(next.iterationExpandedStates['iter-root']).toBe(true);
    expect(child?.isInIteration).toBe(true);
    expect(child?.iterationIndex).toBe(0);
    expect(child?.status).toBe('running');
  });

  it('tracks loop progression and completes loop node', () => {
    const store = useWorkflowExecutionStore.getState();

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

    const next = useWorkflowExecutionStore.getState();
    const loopNode = next.nodes.find(node => node.id === 'loop-root');

    expect(next.currentLoop).toBeNull();
    expect(loopNode?.status).toBe('completed');
    expect(loopNode?.totalLoops).toBe(2);
    expect(loopNode?.description).toContain('executed 2 times');
  });
});
