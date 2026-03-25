/** @jest-environment node */
import {
  buildNormalizedWorkflowInputs,
  isWorkflowNodeEvent,
  upsertWorkflowNodeSnapshot,
} from '@lib/hooks/use-workflow-execution/event-helpers';

describe('workflow execution event helpers', () => {
  it('normalizes workflow input keys without overwriting explicit lowercase keys', () => {
    expect(
      buildNormalizedWorkflowInputs({
        Title: 'Alpha',
        title: 'Beta',
        '   ': 'skip',
        Empty: undefined,
      })
    ).toEqual({
      Title: 'Alpha',
      title: 'Beta',
    });
  });

  it('detects workflow node events by node_id', () => {
    expect(
      isWorkflowNodeEvent({
        event: 'node_started',
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        data: {
          id: 'evt-1',
          node_id: 'node-1',
          node_type: 'llm',
          title: 'Node 1',
          index: 0,
          inputs: {},
          created_at: 1,
        },
      })
    ).toBe(true);
    expect(
      isWorkflowNodeEvent({
        event: 'workflow_started',
        task_id: 'task-1',
        workflow_run_id: 'run-1',
        data: {
          id: 'evt-2',
          workflow_id: 'workflow-1',
          sequence_number: 1,
          created_at: 1,
        },
      })
    ).toBe(false);
  });

  it('merges repeated workflow node snapshots by node id', () => {
    const snapshots = upsertWorkflowNodeSnapshot(
      [
        {
          node_id: 'node-1',
          title: 'Start',
          status: 'running',
          event_type: 'node_started',
        },
      ],
      {
        node_id: 'node-1',
        status: 'succeeded',
        total_tokens: 12,
        event_type: 'node_finished',
      }
    );

    expect(snapshots).toEqual([
      {
        node_id: 'node-1',
        title: 'Start',
        status: 'succeeded',
        total_tokens: 12,
        event_type: 'node_finished',
      },
    ]);
  });
});
