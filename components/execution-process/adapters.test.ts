import {
  difyProcessItem,
  processStatus,
  toolProcessItem,
  visibleDifyNodes,
  workflowSnapshotItems,
} from './adapters';

describe('execution process projection', () => {
  it.each(['pending', 'running', 'completed', 'failed', 'stopped', 'unknown'])(
    'preserves controlled status %s',
    status => expect(processStatus(status)).toBe(status)
  );

  it('maps native success and does not guess other states', () => {
    expect(processStatus('succeeded')).toBe('completed');
    for (const value of [undefined, null, '', 'timeout', 'partial-succeeded']) {
      expect(processStatus(value)).toBe('unknown');
    }
  });

  it('selects safe tool fields and keeps run-scoped identities', () => {
    const tool = {
      runId: 'run-one',
      toolCallId: 'same-id',
      name: 'Search',
      status: 'completed',
      summary: 'PRIVATE_RESULT',
      arguments: 'PRIVATE_ARGUMENTS',
      outputs: 'PRIVATE_OUTPUTS',
    };
    expect(toolProcessItem(tool)).toEqual({
      key: JSON.stringify(['run-one', 'same-id']),
      title: 'Search',
      kind: 'tool',
      status: 'completed',
    });
    expect(toolProcessItem({ ...tool, runId: 'run-two' }).key).not.toBe(
      toolProcessItem(tool).key
    );
    expect(toolProcessItem({ ...tool, status: 'running' }).status).toBe(
      'running'
    );
  });

  it('projects only known valid native durations', () => {
    const node = {
      id: 'node',
      title: 'Step',
      status: 'failed',
      startTime: 10,
      endTime: 10,
    };
    expect(difyProcessItem(node, 'run').durationMs).toBe(0);
    expect(
      difyProcessItem({ ...node, endTime: 9 }, 'run').durationMs
    ).toBeUndefined();
    expect(
      difyProcessItem({ ...node, startTime: NaN }, 'run').durationMs
    ).toBeUndefined();
    expect(
      difyProcessItem({ ...node, endTime: undefined }, 'run').durationMs
    ).toBeUndefined();
    expect(difyProcessItem(node, 'another').key).not.toBe(
      difyProcessItem(node, 'run').key
    );
  });

  it.each(['pending', 'running', 'completed', 'failed', 'stopped', 'unknown'])(
    'only downgrades unfinished tool status %s for historical display',
    status => {
      const tool = {
        runId: 'saved-run',
        toolCallId: 'tool',
        name: 'Search',
        status,
      };
      expect(toolProcessItem(tool, true).status).toBe(
        ['pending', 'running'].includes(status) ? 'unknown' : status
      );
      expect(toolProcessItem(tool).status).toBe(status);
      expect(tool.status).toBe(status);
    }
  );

  it('reads workflow snapshots without mutating or copying raw payloads', () => {
    const metadata = {
      node_executions: [
        {
          node_id: 'same',
          title: 'Start',
          status: 'succeeded',
          elapsed_time: 0,
          inputs: { secret: 'PRIVATE_INPUT' },
          outputs: 'PRIVATE_OUTPUT',
          error: 'PRIVATE_ERROR',
          process_data: 'PRIVATE_PROCESS',
          execution_metadata: 'PRIVATE_METADATA',
        },
        { node_id: 'same', title: 'Next', status: 'failed', elapsed_time: 1.5 },
        {
          node_id: 'last',
          title: 'Incomplete',
          status: 'running',
          elapsed_time: null,
        },
      ],
    };
    const original = JSON.stringify(metadata);
    const items = workflowSnapshotItems(metadata, 'history');
    expect(items).toEqual([
      {
        key: JSON.stringify(['history', 'same', 0]),
        title: 'Start',
        kind: 'step',
        status: 'completed',
        durationMs: 0,
      },
      {
        key: JSON.stringify(['history', 'same', 1]),
        title: 'Next',
        kind: 'step',
        status: 'failed',
        durationMs: 1500,
      },
      {
        key: JSON.stringify(['history', 'last', 2]),
        title: 'Incomplete',
        kind: 'step',
        status: 'unknown',
      },
    ]);
    expect(JSON.stringify(items)).not.toContain('PRIVATE');
    expect(JSON.stringify(metadata)).toBe(original);
    expect(workflowSnapshotItems(metadata, 'other')[0].key).not.toBe(
      items[0].key
    );
  });

  it.each([
    null,
    undefined,
    [],
    {},
    { node_executions: 'invalid' },
    { node_executions: [null, [], {}, { node_id: '' }, { node_id: 7 }] },
  ])('handles absent or malformed snapshots: %p', metadata =>
    expect(workflowSnapshotItems(metadata, 'run')).toEqual([])
  );

  it.each(['collected_node_data', 'collected_node_summary'])(
    'supports the saved failure format %s with the same allowlist',
    field => {
      expect(
        workflowSnapshotItems(
          {
            error_details: {
              [field]: [
                {
                  node_id: 'failed',
                  status: 'failed',
                  elapsed_time: Infinity,
                  error: 'PRIVATE_ERROR',
                },
              ],
            },
          },
          'failed'
        )
      ).toEqual([
        {
          key: JSON.stringify(['failed', 'failed', 0]),
          title: '',
          kind: 'step',
          status: 'failed',
        },
      ]);
    }
  );

  it('keeps Dify containers and their expansion-driven nested visibility', () => {
    const nodes = [
      { id: 'iteration', isIterationNode: true },
      { id: 'nested', isInIteration: true },
      { id: 'loop', isLoopNode: true },
      { id: 'loop-child', isInLoop: true },
      { id: 'parallel', isParallelNode: true },
      { id: 'standalone' },
    ];
    expect(visibleDifyNodes(nodes, {}, {}).map(node => node.id)).toEqual([
      'iteration',
      'loop',
      'parallel',
      'standalone',
    ]);
    expect(
      visibleDifyNodes(nodes, { iteration: true }, { loop: true })
    ).toEqual(nodes);
  });
});
