import type { AppExecution } from '@lib/types/database';

import {
  hasDetailedTaskResult,
  mergeTaskExecutions,
  taskInputText,
  taskOutputText,
} from './projection';

const execution = (id: string, created_at: string, status = 'completed') =>
  ({ id, created_at, status }) as AppExecution;

describe('task chat projection', () => {
  it('only offers a detailed result for structured or multi-field output', () => {
    expect(hasDetailedTaskResult(null)).toBe(false);
    expect(hasDetailedTaskResult({})).toBe(false);
    expect(hasDetailedTaskResult({ result: '# Complete answer' })).toBe(false);
    expect(hasDetailedTaskResult({ generated_text: 'answer' })).toBe(false);
    expect(hasDetailedTaskResult({ result1: 'one', result2: 'two' })).toBe(
      true
    );
    expect(hasDetailedTaskResult({ files: [{ url: '/file' }] })).toBe(true);
    expect(hasDetailedTaskResult({ count: 0 })).toBe(true);
  });
  it('does not let a delayed running snapshot regress a completed task', () => {
    const completed = {
      ...execution('1', '2026-01-01'),
      updated_at: '2026-01-01 00:00:02+00',
    };
    const stale = {
      ...completed,
      status: 'running' as const,
      updated_at: '2026-01-01 00:00:01+00',
    };
    expect(mergeTaskExecutions([completed], [stale])).toEqual([completed]);
    expect(
      mergeTaskExecutions(
        [completed],
        [{ ...stale, updated_at: completed.updated_at }]
      )
    ).toEqual([completed]);
  });
  it('deduplicates by immutable execution ID and preserves microsecond/id ordering', () => {
    const old = execution('b', '2026-01-01 01:00:00.000002+00');
    const newer = {
      ...old,
      status: 'failed' as const,
      updated_at: '2030-01-01',
    };
    expect(
      mergeTaskExecutions(
        [old],
        [
          newer,
          execution('z', '2026-01-01 01:00:00.000001+00'),
          execution('a', old.created_at),
        ]
      )
    ).toEqual([
      execution('z', '2026-01-01 01:00:00.000001+00'),
      execution('a', old.created_at),
      newer,
    ]);
  });
  it('does not project uploaded file references as user prose', () => {
    expect(
      taskInputText({
        topic: 'test',
        count: 0,
        file: { upload_file_id: 'file' },
        files: [{ upload_file_id: 'another' }],
      })
    ).toBe('topic: test\ncount: 0');
  });
  it('uses saved task outputs without borrowing another live run', () => {
    expect(taskOutputText({ generated_text: 'answer', word_count: 1 })).toBe(
      'answer'
    );
    expect(
      taskOutputText({ result: 'workflow', file: { url: 'example' } })
    ).toBe('result:\nworkflow');
    expect(taskOutputText(null)).toBe('');
  });
});
