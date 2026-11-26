/** @jest-environment node */
import type { PoolClient } from 'pg';

import {
  queryRowsWithPgSystemContext,
  runWithPgSystemContext,
} from '../../lib/pg-context';
import { handleAppExecutionAction } from './app-execution-actions';
import { handleConversationAction } from './conversation-actions';
import { sanitizeExecution } from './helpers';
import { handleTaskExecutionAction } from './task-execution-actions';
import type { AppExecutionRow } from './types';

jest.mock('../../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
  runWithPgSystemContext: jest.fn(),
}));

const actor = '00000000-0000-4000-8000-000000000001';
const app = '00000000-0000-4000-8000-000000000002';
const conversation = '00000000-0000-4000-8000-000000000003';
const submission = '00000000-0000-4000-8000-000000000004';
const execution: AppExecutionRow = {
  id: '00000000-0000-4000-8000-000000000005',
  user_id: actor,
  service_instance_id: app,
  conversation_id: conversation,
  submission_id: submission,
  execution_type: 'workflow',
  title: 'Task',
  inputs: { nested: { a: 1, b: 2 }, file: { upload_file_id: 'file-1' } },
  status: 'pending',
  created_at: '2026-11-22 12:00:00.123456+00',
  updated_at: '2026-11-22 12:00:00.123456+00',
  completed_at: null,
  external_execution_id: null,
  task_id: null,
  outputs: null,
  error_message: null,
  total_steps: 0,
  total_tokens: 0,
  elapsed_time: null,
  metadata: {},
};
const reservation = {
  serviceInstanceId: app,
  submissionId: submission,
  title: ' Task ',
  inputs: execution.inputs,
};
const query = jest.fn();

beforeEach(() => {
  jest.resetAllMocks();
  query.mockResolvedValue({ rows: [] });
  jest
    .mocked(runWithPgSystemContext)
    .mockImplementation(operation =>
      operation({ query } as unknown as PoolClient)
    );
});

function rows(...results: unknown[][]) {
  for (const result of results) query.mockResolvedValueOnce({ rows: result });
}

describe('task reservation', () => {
  it('sanitizes linked IDs and supplies explicit nulls for legacy execution fixtures', () => {
    expect(sanitizeExecution(execution)).toMatchObject({
      conversation_id: conversation,
      submission_id: submission,
    });
    expect(
      sanitizeExecution({
        ...execution,
        conversation_id: undefined,
        submission_id: undefined,
      })
    ).toMatchObject({ conversation_id: null, submission_id: null });
  });
  it('requires an authenticated actor, never a payload identity', async () => {
    const result = await handleTaskExecutionAction(
      'appExecutions.reserveTask',
      { ...reservation, userId: actor },
      undefined
    );
    expect(result?.statusCode).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it.each([
    { submissionId: 'not-a-uuid' },
    { serviceInstanceId: 'slug' },
    { conversationId: 'bad' },
    { inputs: [] },
    { inputs: null },
    { title: '' },
    { title: 'x'.repeat(501) },
  ])('rejects malformed reservation %j', async invalid => {
    expect(
      (
        await handleTaskExecutionAction(
          'appExecutions.reserveTask',
          { ...reservation, ...invalid },
          actor
        )
      )?.statusCode
    ).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it.each(['workflow', 'text-generation'])(
    'atomically creates a server-derived %s conversation and one execution only',
    async taskType => {
      rows(
        [],
        [{ task_type: taskType }],
        [],
        [{ id: conversation }],
        [{ ...execution, execution_type: taskType }]
      );
      const result = await handleTaskExecutionAction(
        'appExecutions.reserveTask',
        { ...reservation, executionType: 'forged' },
        actor
      );
      expect(result?.payload).toMatchObject({
        success: true,
        data: {
          conversationId: conversation,
          replayed: false,
          execution: { execution_type: taskType },
        },
      });
      expect(runWithPgSystemContext).toHaveBeenCalledTimes(1);
      const statements = query.mock.calls
        .map(([sql]) => sql as string)
        .join('\n');
      expect(statements).toContain('pg_advisory_xact_lock');
      expect(statements).toContain("provider.type IN ('dify', 'llm')");
      expect(statements).toContain("'interaction_protocol', 'native'");
      expect(statements).toContain("access_actor.status = 'active'");
      expect(statements).toContain('access_provider.is_active = TRUE');
      expect(statements).toContain('access_permission.is_enabled = TRUE');
      for (const forbidden of [
        'INSERT INTO messages',
        'INSERT INTO backend_conversations',
        'agent_submissions',
        'used_count',
        'admitSubmission',
      ])
        expect(statements).not.toContain(forbidden);
      expect(query.mock.calls[3][1]).toEqual([
        actor,
        app,
        'Task',
        JSON.stringify({ runtime: 'dify-task', task_type: taskType }),
      ]);
      expect(query.mock.calls[4][1]).toEqual([
        actor,
        app,
        conversation,
        submission,
        taskType,
        'Task',
        JSON.stringify(execution.inputs),
      ]);
    }
  );

  it('rejects an inaccessible, disabled, non-native or non-task app before any inserts', async () => {
    rows([], []);
    expect(
      (
        await handleTaskExecutionAction(
          'appExecutions.reserveTask',
          reservation,
          actor
        )
      )?.statusCode
    ).toBe(404);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, conversation])(
    'replays normalized content with conversation %s',
    async conversationId => {
      rows(
        [],
        [{ task_type: 'workflow' }],
        [execution],
        [{ id: conversation }],
        [execution]
      );
      const result = await handleTaskExecutionAction(
        'appExecutions.reserveTask',
        {
          ...reservation,
          ...(conversationId ? { conversationId } : {}),
          inputs: {
            file: { upload_file_id: 'file-1' },
            nested: { b: 2, a: 1 },
          },
        },
        actor
      );
      expect(result?.payload).toMatchObject({
        data: {
          replayed: true,
          conversationId: conversation,
          execution: { id: execution.id },
        },
      });
      expect(query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(
        false
      );
      expect(query.mock.calls[3][0]).toContain('FOR UPDATE');
    }
  );

  it.each([
    { title: 'different' },
    { inputs: { file: { upload_file_id: 'file-2' } } },
    { conversationId: '00000000-0000-4000-8000-000000000009' },
  ])('conflicts when the same submission changes %j', async changed => {
    rows([], [{ task_type: 'workflow' }], [execution]);
    expect(
      (
        await handleTaskExecutionAction(
          'appExecutions.reserveTask',
          { ...reservation, ...changed },
          actor
        )
      )?.statusCode
    ).toBe(409);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(
      false
    );
  });

  it('does not replay a deleted conversation or recreate it', async () => {
    rows([], [{ task_type: 'workflow' }], [execution], []);
    expect(
      (
        await handleTaskExecutionAction(
          'appExecutions.reserveTask',
          reservation,
          actor
        )
      )?.statusCode
    ).toBe(409);
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(
      false
    );
  });

  it('checks pending executions only after locking the active, owned, same-app task conversation', async () => {
    rows(
      [],
      [{ task_type: 'workflow' }],
      [],
      [{ id: conversation }],
      [{ id: execution.id }]
    );
    expect(
      (
        await handleTaskExecutionAction(
          'appExecutions.reserveTask',
          { ...reservation, conversationId: conversation },
          actor
        )
      )?.statusCode
    ).toBe(409);
    expect(query.mock.calls[3][0]).toContain('FOR UPDATE');
    expect(query.mock.calls[3][0]).toContain('app_id = $3');
    expect(query.mock.calls[3][0]).toContain('NOT EXISTS');
    expect(query.mock.calls[4][0]).toContain(
      "status IN ('pending', 'running')"
    );
    expect(query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(
      false
    );
  });

  it('lets insert failures escape the transaction for rollback', async () => {
    rows([], [{ task_type: 'workflow' }], [], [{ id: conversation }]);
    query.mockRejectedValueOnce(new Error('synthetic insert failure'));
    await expect(
      handleTaskExecutionAction('appExecutions.reserveTask', reservation, actor)
    ).rejects.toThrow('synthetic insert failure');
  });
});

describe('conversation cursor history', () => {
  it('returns the recent 20 chronologically and a stable UUID cursor for older rows', async () => {
    const descending = Array.from({ length: 21 }, (_, index) => ({
      ...execution,
      id: `00000000-0000-4000-8000-${String(40 - index).padStart(12, '0')}`,
    }));
    rows([{ id: conversation }], descending);
    const result = await handleTaskExecutionAction(
      'appExecutions.getByConversation',
      { conversationId: conversation },
      actor
    );
    expect(result?.payload).toMatchObject({
      data: {
        executions: descending
          .slice(0, 20)
          .reverse()
          .map(item => expect.objectContaining({ id: item.id })),
        hasMore: true,
        nextCursor: descending[19].id,
      },
    });
    expect(query.mock.calls[1][0]).toContain(
      'ORDER BY created_at DESC, id DESC LIMIT $3'
    );
    expect(query.mock.calls[1][1]).toEqual([conversation, actor, 21]);
  });

  it('uses immutable microsecond timestamp and UUID boundaries, even if a cursor row was deleted', async () => {
    rows(
      [{ id: conversation }],
      [{ id: execution.id, created_at: execution.created_at }],
      [execution]
    );
    const result = await handleTaskExecutionAction(
      'appExecutions.getByConversation',
      { conversationId: conversation, cursor: execution.id, limit: 1000 },
      actor
    );
    expect(result?.payload).toMatchObject({
      data: { hasMore: false, nextCursor: null },
    });
    expect(query.mock.calls[1][0]).toContain(
      'conversation_id = $2::uuid AND user_id = $3::uuid'
    );
    expect(query.mock.calls[2][0]).toContain(
      '(created_at, id) < ($4::timestamptz, $5::uuid)'
    );
    expect(query.mock.calls[2][0]).not.toContain('updated_at <');
    expect(query.mock.calls[2][1]).toEqual([
      conversation,
      actor,
      101,
      execution.created_at,
      execution.id,
    ]);
  });

  it('returns an explicit end marker for an empty conversation', async () => {
    rows([{ id: conversation }], []);
    expect(
      (
        await handleTaskExecutionAction(
          'appExecutions.getByConversation',
          { conversationId: conversation },
          actor
        )
      )?.payload
    ).toEqual({
      success: true,
      data: { executions: [], hasMore: false, nextCursor: null },
    });
  });

  it('rejects a cursor from another conversation rather than exposing its boundary', async () => {
    rows([{ id: conversation }], []);
    expect(
      (
        await handleTaskExecutionAction(
          'appExecutions.getByConversation',
          { conversationId: conversation, cursor: execution.id },
          actor
        )
      )?.statusCode
    ).toBe(400);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('checks active conversation and live app permission before paging', async () => {
    rows([]);
    expect(
      (
        await handleTaskExecutionAction(
          'appExecutions.getByConversation',
          { conversationId: conversation },
          actor
        )
      )?.statusCode
    ).toBe(404);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain(
      "metadata ->> 'runtime' = 'dify-task'"
    );
    expect(query.mock.calls[0][0]).not.toContain('dify_apptype');
  });

  it.each([
    { cursor: 'bad' },
    { limit: 0 },
    { limit: -1 },
    { limit: 1.5 },
    { limit: '20' },
  ])('rejects invalid paging %j', async invalid => {
    expect(
      (
        await handleTaskExecutionAction(
          'appExecutions.getByConversation',
          { conversationId: conversation, ...invalid },
          actor
        )
      )?.statusCode
    ).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('execution update/delete serialization', () => {
  it.each([
    ['appExecutions.updateStatus', { status: 'completed' }],
    [
      'appExecutions.updateComplete',
      { completeData: { status: 'completed', outputs: { text: 'done' } } },
    ],
    ['appExecutions.delete', {}],
  ])(
    '%s locks the conversation before guarded SQL and cannot restore deletion',
    async (action, extra) => {
      rows([{ conversation_id: conversation }], [{ id: conversation }], []);
      const response = await handleAppExecutionAction(
        action,
        { executionId: execution.id, ...extra },
        actor
      );
      expect(response?.statusCode).toBe(409);
      expect(query.mock.calls[1][0]).toContain('FOR UPDATE');
      const sql = query.mock.calls[2][0] as string;
      for (const required of [
        'UPDATE app_executions',
        'app_executions.user_id =',
        "status <> 'deleted'::execution_status",
        "execution_conversation.status = 'active'",
        'access_permission.is_enabled = TRUE',
        "access_actor.status = 'active'",
        'access_provider.is_active = TRUE',
      ])
        expect(sql).toContain(required);
      expect(query.mock.calls[2][1]).toContain(actor);
      if (action !== 'appExecutions.delete')
        expect(sql).toContain(
          "error_message IS DISTINCT FROM 'CLIENT_TASK_INTERRUPTED'"
        );
      else expect(sql).not.toContain('CLIENT_TASK_INTERRUPTED');
      expect(sql).not.toContain('UPDATE conversations');
    }
  );

  it('allows authorized legacy null-linked updates, without a conversation lock', async () => {
    rows(
      [{ conversation_id: null }],
      [
        {
          ...execution,
          conversation_id: null,
          submission_id: null,
          status: 'completed',
        },
      ]
    );
    expect(
      (
        await handleAppExecutionAction(
          'appExecutions.updateComplete',
          { executionId: execution.id, completeData: { status: 'completed' } },
          actor
        )
      )?.statusCode
    ).toBe(200);
    expect(query).toHaveBeenCalledTimes(2);
    expect(query.mock.calls[1][0]).not.toContain('FOR UPDATE');
    expect(query.mock.calls[1][0]).toContain(
      'app_executions.conversation_id IS NULL'
    );
  });

  it.each([
    'appExecutions.getUserExecutions',
    'appExecutions.getByServiceInstance',
    'appExecutions.getById',
  ])(
    '%s excludes deleted rows/conversations and rechecks live app access',
    async action => {
      jest.mocked(queryRowsWithPgSystemContext).mockResolvedValueOnce([]);
      await handleAppExecutionAction(
        action,
        { serviceInstanceId: app, executionId: execution.id },
        actor
      );
      const sql = jest.mocked(queryRowsWithPgSystemContext).mock.calls[0][0];
      expect(sql).toContain("execution_conversation.status = 'active'");
      expect(sql).toContain("app_executions.status <> 'deleted'");
      expect(sql).toContain('access_permission.is_enabled = TRUE');
      expect(sql).toContain('app_executions.conversation_id IS NULL');
    }
  );

  it('deletes linked executions in the same transaction, after taking the shared conversation lock', async () => {
    rows([{ id: conversation }], [], []);
    expect(
      (
        await handleConversationAction(
          'conversations.deleteConversation',
          { conversationId: conversation },
          actor
        )
      )?.payload
    ).toEqual({ success: true, data: true });
    expect(runWithPgSystemContext).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(query.mock.calls[1][0]).toContain('UPDATE conversations');
    expect(query.mock.calls[2][0]).toContain('UPDATE app_executions');
    expect(query.mock.calls[2][1]).toEqual([conversation, actor]);
  });

  it('does not touch executions when the conversation is missing or foreign', async () => {
    rows([]);
    expect(
      (
        await handleConversationAction(
          'conversations.deleteConversation',
          { conversationId: conversation },
          actor
        )
      )?.payload
    ).toEqual({ success: true, data: false });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('rejects forged task metadata and linked execution creation through generic actions', async () => {
    expect(
      (
        await handleConversationAction(
          'conversations.createConversation',
          { conversation: { metadata: { runtime: 'dify-task' } } },
          actor
        )
      )?.statusCode
    ).toBe(409);
    expect(
      (
        await handleAppExecutionAction(
          'appExecutions.create',
          { execution: { conversation_id: conversation } },
          actor
        )
      )?.statusCode
    ).toBe(409);
    expect(query).not.toHaveBeenCalled();
    expect(queryRowsWithPgSystemContext).not.toHaveBeenCalled();
  });
});
