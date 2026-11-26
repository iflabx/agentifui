/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { Pool, type PoolClient } from 'pg';

import {
  canReadDifyUpload,
  hasDifyUploadReference,
  registerDifyUpload,
} from '../../apps/api/src/lib/dify-upload-access';
import {
  getPgPool,
  queryRowsWithPgUserContext,
} from '../../apps/api/src/lib/pg-context';
import { handleAppExecutionAction } from '../../apps/api/src/routes/internal-data-route/app-execution-actions';
import { handleConversationAction } from '../../apps/api/src/routes/internal-data-route/conversation-actions';
import { handleMessageAction } from '../../apps/api/src/routes/internal-data-route/message-actions';
import { handleTaskExecutionAction } from '../../apps/api/src/routes/internal-data-route/task-execution-actions';
import type {
  ApiActionResponse,
  AppExecutionRow,
} from '../../apps/api/src/routes/internal-data-route/types';
import { resolveTestDatabaseUrl } from './helpers/test-database-url';
import { createTestRole, dropTestRole } from './helpers/test-role';

const actor = randomUUID();
const outsider = randomUUID();
const provider = randomUUID();
const apps = [randomUUID(), randomUUID()];
const group = randomUUID();
const role = `uc02_${randomUUID().replaceAll('-', '')}`;
const marker = `uc02-${randomUUID()}`;
const originalEnv = { ...process.env };
let database: Pool;
let runtimePool: Pool | undefined;
let roleCreated = false;

function data<Result>(response: ApiActionResponse | null): Result {
  expect(response?.statusCode).toBe(200);
  return (response?.payload as { data: Result }).data;
}

function reserve(options: Record<string, unknown> = {}, userId = actor) {
  return handleTaskExecutionAction(
    'appExecutions.reserveTask',
    {
      serviceInstanceId: apps[0],
      submissionId: randomUUID(),
      title: 'Synthetic task',
      inputs: {},
      ...options,
    },
    userId
  );
}

type Reservation = {
  execution: AppExecutionRow;
  conversationId: string;
  replayed: boolean;
};
type Page = {
  executions: AppExecutionRow[];
  hasMore: boolean;
  nextCursor: string | null;
};

function history(
  conversationId: string,
  options: Record<string, unknown> = {},
  userId = actor
) {
  return handleTaskExecutionAction(
    'appExecutions.getByConversation',
    { conversationId, ...options },
    userId
  );
}

function complete(executionId: string, userId = actor) {
  return handleAppExecutionAction(
    'appExecutions.updateComplete',
    {
      executionId,
      completeData: {
        status: 'completed',
        outputs: { text: 'Synthetic result' },
      },
    },
    userId
  );
}

function remove(conversationId: string) {
  return handleConversationAction(
    'conversations.deleteConversation',
    { conversationId },
    actor
  );
}

async function waitForLock(fragment: string, count = 1) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const waiting = await database.query<{ count: string }>(
      `SELECT count(*)::text FROM pg_stat_activity
       WHERE datname = current_database() AND pid <> pg_backend_pid()
         AND wait_event_type = 'Lock' AND query LIKE $1`,
      [`%${fragment}%`]
    );
    if (Number(waiting.rows[0].count) >= count) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(`Timed out awaiting isolated task-history lock: ${fragment}`);
}

describe('UC-02 migrated isolated database task history', () => {
  jest.setTimeout(30000);

  beforeAll(async () => {
    const url = new URL(
      process.env.UC02_TEST_DATABASE_URL || resolveTestDatabaseUrl()
    );
    if (url.pathname !== '/agentifui_test') {
      throw new Error(
        'UC-02 integration tests require the isolated agentifui_test database with all migrations applied'
      );
    }
    database = new Pool({ connectionString: url.toString() });
    await database.query(
      'SELECT conversation_id, submission_id FROM app_executions LIMIT 0'
    );
    await createTestRole(database, role);
    roleCreated = true;
    for (const userId of [actor, outsider]) {
      await database.query(
        'INSERT INTO auth_users(id,name,email) VALUES($1,$2,$3)',
        [userId, marker, `${userId}@example.invalid`]
      );
      await database.query(
        "INSERT INTO profiles(id,email,role,status) VALUES($1,$2,'user','active')",
        [userId, `${userId}@example.invalid`]
      );
    }
    await database.query(
      "INSERT INTO providers(id,name,type,base_url,auth_type) VALUES($1,$2,'llm','https://synthetic.invalid','bearer')",
      [provider, marker]
    );
    await database.query('INSERT INTO groups(id,name) VALUES($1,$2)', [
      group,
      marker,
    ]);
    await database.query(
      'INSERT INTO group_members(group_id,user_id) VALUES($1,$2)',
      [group, actor]
    );
    for (const [index, appId] of apps.entries()) {
      await database.query(
        "INSERT INTO service_instances(id,provider_id,instance_id,visibility,config) VALUES($1,$2,$3,'group_only',$4::jsonb)",
        [
          appId,
          provider,
          `${marker}-${index}`,
          JSON.stringify({
            app_metadata: {
              dify_apptype: index === 0 ? 'workflow' : 'text-generation',
            },
          }),
        ]
      );
      await database.query(
        'INSERT INTO group_app_permissions(group_id,service_instance_id,usage_quota) VALUES($1,$2,100)',
        [group, appId]
      );
    }
    url.searchParams.set('options', `-c role=${role}`);
    process.env.DATABASE_URL = url.toString();
    process.env.APP_RLS_STRICT_MODE = 'true';
    runtimePool = getPgPool();
  });

  afterAll(async () => {
    if (database) {
      if (runtimePool) {
        await runtimePool.end();
        delete (globalThis as Record<string, unknown>)
          .__agentifui_fastify_pg_pool__;
      }
      await database.query(
        'DELETE FROM app_executions WHERE service_instance_id = ANY($1::uuid[])',
        [apps]
      );
      await database.query(
        'DELETE FROM conversations WHERE user_id = ANY($1::uuid[])',
        [[actor, outsider]]
      );
      await database.query('DELETE FROM groups WHERE id=$1::uuid', [group]);
      await database.query('DELETE FROM providers WHERE id=$1::uuid', [
        provider,
      ]);
      await database.query('DELETE FROM profiles WHERE id = ANY($1::uuid[])', [
        [actor, outsider],
      ]);
      await database.query(
        'DELETE FROM auth_users WHERE id = ANY($1::uuid[])',
        [[actor, outsider]]
      );
      if (roleCreated) await dropTestRole(database, role);
      await database.end();
    }
    process.env = originalEnv;
  });

  it('keeps profile deletion compatible with linked and soft-deleted tasks', async () => {
    await database.query('BEGIN');
    try {
      const owner = randomUUID(),
        conversation = randomUUID();
      await database.query(
        "INSERT INTO profiles(id,role,status) VALUES($1,'user','active')",
        [owner]
      );
      await database.query(
        "INSERT INTO conversations(id,user_id,app_id,title) VALUES($1,$2,$3,'Synthetic cascade')",
        [conversation, owner, apps[0]]
      );
      await database.query(
        "INSERT INTO app_executions(user_id,service_instance_id,conversation_id,execution_type,title,status) VALUES($1,$2,$3,'workflow','Synthetic cascade','deleted')",
        [owner, apps[0], conversation]
      );
      await database.query('DELETE FROM profiles WHERE id=$1', [owner]);
      expect(
        (
          await database.query(
            'SELECT id FROM app_executions WHERE conversation_id=$1',
            [conversation]
          )
        ).rows
      ).toEqual([]);
    } finally {
      await database.query('ROLLBACK');
    }
  });

  it('refreshes conversation activity for new tasks, not reservation replays', async () => {
    const first = data<Reservation>(await reserve());
    await complete(first.execution.id);
    await database.query(
      "UPDATE conversations SET updated_at='2000-01-01' WHERE id=$1",
      [first.conversationId]
    );
    const submissionId = randomUUID();
    const payload = {
      conversationId: first.conversationId,
      submissionId,
      title: 'Second synthetic task',
    };
    data<Reservation>(await reserve(payload));
    const before = (
      await database.query(
        'SELECT updated_at::text,last_message_preview FROM conversations WHERE id=$1',
        [first.conversationId]
      )
    ).rows[0];
    expect(before.last_message_preview).toBe('Second synthetic task');
    expect(Date.parse(before.updated_at)).toBeGreaterThan(
      Date.parse('2000-01-01')
    );
    data<Reservation>(await reserve(payload));
    expect(
      (
        await database.query(
          'SELECT updated_at::text,last_message_preview FROM conversations WHERE id=$1',
          [first.conversationId]
        )
      ).rows[0]
    ).toEqual(before);
  });

  it('reserves both task modes under legacy llm provider, without native bindings/messages or quota admission', async () => {
    for (const [index, appId] of apps.entries()) {
      const result = data<Reservation>(
        await reserve({ serviceInstanceId: appId })
      );
      expect(result.execution.conversation_id).toBe(result.conversationId);
      expect(result.execution.submission_id).toBeTruthy();
      const row = await database.query(
        `SELECT app_id, metadata, external_id,
        (SELECT count(*) FROM messages WHERE conversation_id=c.id)::int AS messages,
        (SELECT count(*) FROM backend_conversations WHERE conversation_id=c.id)::int AS bindings
        FROM conversations c WHERE id=$1::uuid`,
        [result.conversationId]
      );
      expect(row.rows[0]).toMatchObject({
        app_id: appId,
        metadata: {
          runtime: 'dify-task',
          task_type: index === 0 ? 'workflow' : 'text-generation',
        },
        external_id: null,
        messages: 0,
        bindings: 0,
      });
    }
    expect(
      (
        await database.query(
          'SELECT used_count FROM group_app_permissions WHERE group_id=$1',
          [group]
        )
      ).rows.every(row => row.used_count === 0)
    ).toBe(true);
    expect(
      (
        await database.query(
          'SELECT count(*)::int AS count FROM agent_submissions WHERE user_id=$1',
          [actor]
        )
      ).rows[0].count
    ).toBe(0);
  });

  it('concurrent first submissions replay exactly one conversation/execution and changed file/content/conversation conflicts', async () => {
    const submissionId = randomUUID();
    const request = {
      submissionId,
      inputs: {
        nested: { b: 2, a: 1 },
        file: { upload_file_id: 'synthetic-file' },
      },
    };
    const results = (
      await Promise.all(Array.from({ length: 4 }, () => reserve(request)))
    ).map(result => data<Reservation>(result));
    expect(new Set(results.map(result => result.execution.id)).size).toBe(1);
    expect(results.filter(result => !result.replayed)).toHaveLength(1);
    const conversationId = results[0].conversationId;
    expect(
      data<Reservation>(
        await reserve({
          ...request,
          conversationId,
          inputs: {
            file: { upload_file_id: 'synthetic-file' },
            nested: { a: 1, b: 2 },
          },
        })
      ).replayed
    ).toBe(true);
    for (const changed of [
      { title: 'changed' },
      { inputs: { file: { upload_file_id: 'other-file' } } },
      { conversationId: randomUUID() },
    ]) {
      expect((await reserve({ ...request, ...changed }))?.statusCode).toBe(409);
    }
    const count = await database.query(
      'SELECT count(*)::int AS count FROM app_executions WHERE user_id=$1 AND service_instance_id=$2 AND submission_id=$3',
      [actor, apps[0], submissionId]
    );
    expect(count.rows[0].count).toBe(1);
  });

  it('pages >20 tied timestamps without crossing conversations or skipping after completion updates', async () => {
    const first = data<Reservation>(await reserve());
    const other = data<Reservation>(await reserve());
    await complete(first.execution.id);
    const timestamp = '2026-11-22 12:00:00.123456+00';
    const expected = [first.execution.id];
    await database.query(
      'UPDATE app_executions SET created_at=$2::timestamptz WHERE id=$1',
      [first.execution.id, timestamp]
    );
    for (let index = 0; index < 44; index += 1) {
      const inserted = await database.query<{ id: string }>(
        `INSERT INTO app_executions(user_id,service_instance_id,conversation_id,submission_id,execution_type,title,inputs,status,created_at)
        VALUES($1,$2,$3,$4,'workflow','Synthetic page row','{}','completed',$5::timestamptz) RETURNING id::text`,
        [actor, apps[0], first.conversationId, randomUUID(), timestamp]
      );
      expected.push(inserted.rows[0].id);
    }
    const recent = data<Page>(await history(first.conversationId));
    expect(recent.executions).toHaveLength(20);
    expect(recent.hasMore).toBe(true);
    await complete(recent.executions[0].id);
    await handleAppExecutionAction(
      'appExecutions.delete',
      { executionId: recent.executions[0].id },
      actor
    );
    const older = data<Page>(
      await history(first.conversationId, { cursor: recent.nextCursor })
    );
    const oldest = data<Page>(
      await history(first.conversationId, { cursor: older.nextCursor })
    );
    expect(oldest.hasMore).toBe(false);
    expect(oldest.nextCursor).toBeNull();
    const all = [
      ...oldest.executions,
      ...older.executions,
      ...recent.executions,
    ];
    expect(all.map(item => item.id)).toEqual(expected.sort());
    expect(new Set(all.map(item => item.id)).size).toBe(45);
    expect(all.some(item => item.id === other.execution.id)).toBe(false);
    expect(
      (await history(first.conversationId, { cursor: other.execution.id }))
        ?.statusCode
    ).toBe(400);
  });

  it('denies foreign actor/app/conversation and preserves legacy null-linked executions and RLS ownership', async () => {
    const task = data<Reservation>(await reserve());
    expect((await history(task.conversationId, {}, outsider))?.statusCode).toBe(
      404
    );
    expect((await complete(task.execution.id, outsider))?.statusCode).toBe(409);
    expect(
      (
        await reserve({
          serviceInstanceId: apps[1],
          conversationId: task.conversationId,
        })
      )?.statusCode
    ).toBe(409);
    const legacy = data<AppExecutionRow>(
      await handleAppExecutionAction(
        'appExecutions.create',
        {
          execution: {
            service_instance_id: apps[0],
            execution_type: 'workflow',
            title: 'Legacy fixture',
            inputs: {},
          },
        },
        actor
      )
    );
    expect(
      data<AppExecutionRow>(await complete(legacy.id)).conversation_id
    ).toBeNull();
    expect(
      data<AppExecutionRow>(
        await handleAppExecutionAction(
          'appExecutions.getById',
          { executionId: legacy.id },
          actor
        )
      ).submission_id
    ).toBeNull();
    const visible = await queryRowsWithPgUserContext(
      outsider,
      'user',
      'SELECT id FROM app_executions WHERE id=$1::uuid',
      [task.execution.id]
    );
    expect(visible).toEqual([]);
  });

  it('rejects generic task runtime creation and all task message writes, while rename cannot alter server metadata/app', async () => {
    const task = data<Reservation>(await reserve());
    expect(
      (
        await handleConversationAction(
          'conversations.createConversation',
          {
            conversation: {
              app_id: apps[0],
              metadata: { runtime: 'dify-task', task_type: 'workflow' },
            },
          },
          actor
        )
      )?.statusCode
    ).toBe(409);
    for (const [action, payload] of [
      [
        'messages.save',
        {
          message: {
            conversation_id: task.conversationId,
            role: 'user',
            content: 'forged',
          },
        },
      ],
      [
        'messages.updateMetadata',
        {
          conversationId: task.conversationId,
          messageId: randomUUID(),
          metadata: {},
        },
      ],
      ['messages.createPlaceholder', { conversationId: task.conversationId }],
    ] as const)
      expect(
        (await handleMessageAction(action, payload, actor))?.statusCode
      ).toBe(404);
    expect(
      data<boolean>(
        await handleConversationAction(
          'conversations.renameConversation',
          {
            conversationId: task.conversationId,
            title: 'Renamed',
            app_id: apps[1],
            metadata: { runtime: 'forged', task_type: 'text-generation' },
          },
          actor
        )
      )
    ).toBe(true);
    expect(
      (
        await database.query(
          'SELECT app_id,metadata,title FROM conversations WHERE id=$1',
          [task.conversationId]
        )
      ).rows[0]
    ).toMatchObject({
      app_id: apps[0],
      metadata: { runtime: 'dify-task', task_type: 'workflow' },
      title: 'Renamed',
    });
    expect(
      (
        await database.query(
          'SELECT count(*)::int AS count FROM messages WHERE conversation_id=$1',
          [task.conversationId]
        )
      ).rows[0].count
    ).toBe(0);
  });

  it('preserves explicit interrupted/unknown task markers against late old writes, but allows a fresh submission and deletion', async () => {
    const task = data<Reservation>(await reserve());
    expect(
      data<boolean>(
        await handleAppExecutionAction(
          'appExecutions.updateStatus',
          {
            executionId: task.execution.id,
            status: 'stopped',
            errorMessage: 'CLIENT_TASK_INTERRUPTED',
            completedAt: new Date().toISOString(),
          },
          actor
        )
      )
    ).toBe(true);
    expect((await complete(task.execution.id))?.statusCode).toBe(409);
    for (const status of ['running', 'completed', 'failed'])
      expect(
        (
          await handleAppExecutionAction(
            'appExecutions.updateStatus',
            { executionId: task.execution.id, status },
            actor
          )
        )?.statusCode
      ).toBe(409);
    const recovered = data<Reservation>(
      await reserve({ conversationId: task.conversationId })
    );
    expect(recovered.execution.id).not.toBe(task.execution.id);
    expect(
      (
        await database.query(
          'SELECT status,error_message FROM app_executions WHERE id=$1',
          [task.execution.id]
        )
      ).rows[0]
    ).toEqual({ status: 'stopped', error_message: 'CLIENT_TASK_INTERRUPTED' });
    expect(
      data<boolean>(
        await handleAppExecutionAction(
          'appExecutions.delete',
          { executionId: task.execution.id },
          actor
        )
      )
    ).toBe(true);
  });

  it.each(['permission', 'provider', 'actor'])(
    'rechecks %s changes for history, ID reads, reservation, completion and attachments',
    async kind => {
      const file = {
        userId: actor,
        serviceInstanceId: apps[0],
        fileId: randomUUID(),
      };
      await registerDifyUpload(file);
      const task = data<Reservation>(
        await reserve({ inputs: { upload_file_id: file.fileId } })
      );
      const change =
        kind === 'permission'
          ? [
              'UPDATE group_app_permissions SET is_enabled=$2 WHERE group_id=$1',
              group,
              false,
              true,
            ]
          : kind === 'provider'
            ? [
                'UPDATE providers SET is_active=$2 WHERE id=$1',
                provider,
                false,
                true,
              ]
            : [
                'UPDATE profiles SET status=$2 WHERE id=$1',
                actor,
                'suspended',
                'active',
              ];
      try {
        await database.query(change[0] as string, [change[1], change[2]]);
        expect((await history(task.conversationId))?.statusCode).toBe(404);
        expect(
          data<unknown>(
            await handleAppExecutionAction(
              'appExecutions.getById',
              { executionId: task.execution.id },
              actor
            )
          )
        ).toBeNull();
        expect((await reserve())?.statusCode).toBe(404);
        expect((await complete(task.execution.id))?.statusCode).toBe(409);
        expect(await canReadDifyUpload(file)).toBe(false);
        expect(await hasDifyUploadReference(file)).toBe(false);
      } finally {
        await database.query(change[0] as string, [change[1], change[3]]);
      }
    }
  );

  it('rejects late completion/replay/reservation after conversation deletion without restoring file rights', async () => {
    const file = {
      userId: actor,
      serviceInstanceId: apps[0],
      fileId: randomUUID(),
    };
    await registerDifyUpload(file);
    const submissionId = randomUUID();
    const inputs = { upload_file_id: file.fileId };
    const task = data<Reservation>(await reserve({ submissionId, inputs }));
    expect(
      await canReadDifyUpload(file, { conversationId: task.conversationId })
    ).toBe(true);
    expect(data<boolean>(await remove(task.conversationId))).toBe(true);
    expect((await complete(task.execution.id))?.statusCode).toBe(409);
    expect((await reserve({ submissionId, inputs }))?.statusCode).toBe(409);
    expect(
      (await reserve({ conversationId: task.conversationId }))?.statusCode
    ).toBe(409);
    expect(
      data<unknown>(
        await handleAppExecutionAction(
          'appExecutions.getById',
          { executionId: task.execution.id },
          actor
        )
      )
    ).toBeNull();
    expect(await canReadDifyUpload(file)).toBe(false);
    expect(
      await hasDifyUploadReference(file, { executionId: task.execution.id })
    ).toBe(false);
    expect(await canReadDifyUpload({ ...file, userId: outsider })).toBe(false);
  });

  it('keeps files referenced by a second live conversation while deleting only the selected execution', async () => {
    const file = {
      userId: actor,
      serviceInstanceId: apps[0],
      fileId: randomUUID(),
    };
    await registerDifyUpload(file);
    const first = data<Reservation>(
      await reserve({ inputs: { upload_file_id: file.fileId } })
    );
    const second = data<Reservation>(
      await reserve({ inputs: { upload_file_id: file.fileId } })
    );
    await remove(first.conversationId);
    expect(await canReadDifyUpload(file)).toBe(true);
    data<boolean>(
      await handleAppExecutionAction(
        'appExecutions.delete',
        { executionId: second.execution.id },
        actor
      )
    );
    expect(data<Page>(await history(second.conversationId)).executions).toEqual(
      []
    );
    expect(await canReadDifyUpload(file)).toBe(false);
    expect(
      (
        await database.query('SELECT status FROM conversations WHERE id=$1', [
          second.conversationId,
        ])
      ).rows[0].status
    ).toBe('active');
  });

  it.each(['delete-first', 'completion-first', 'reserve-first'])(
    'serializes concurrent deletion and writes (%s)',
    async order => {
      const file = {
        userId: actor,
        serviceInstanceId: apps[0],
        fileId: randomUUID(),
      };
      await registerDifyUpload(file);
      const task = data<Reservation>(
        await reserve({ inputs: { upload_file_id: file.fileId } })
      );
      await complete(task.execution.id);
      const blocker: PoolClient = await database.connect();
      const pending: Promise<ApiActionResponse | null>[] = [];
      try {
        await blocker.query('BEGIN');
        await blocker.query(
          'SELECT id FROM conversations WHERE id=$1 FOR UPDATE',
          [task.conversationId]
        );
        if (order === 'delete-first') {
          pending.push(remove(task.conversationId));
          await waitForLock('SELECT id::text FROM conversations');
          pending.push(complete(task.execution.id));
          pending.push(reserve({ conversationId: task.conversationId }));
        } else if (order === 'completion-first') {
          pending.push(complete(task.execution.id));
          await waitForLock('SELECT id FROM conversations');
          pending.push(remove(task.conversationId));
        } else {
          pending.push(
            reserve({
              conversationId: task.conversationId,
              inputs: { upload_file_id: file.fileId },
            })
          );
          await waitForLock('SELECT id::text FROM conversations');
          pending.push(remove(task.conversationId));
        }
        await waitForLock('FROM conversations', pending.length);
        await blocker.query('COMMIT');
        const result = await Promise.all(pending);
        if (order === 'delete-first')
          expect(result.map(response => response?.statusCode)).toEqual([
            200, 409, 409,
          ]);
        else
          expect(result.map(response => response?.statusCode)).toEqual([
            200, 200,
          ]);
      } finally {
        await blocker.query('ROLLBACK');
        blocker.release();
        await Promise.allSettled(pending);
      }
      const saved = await database.query(
        'SELECT status FROM app_executions WHERE conversation_id=$1',
        [task.conversationId]
      );
      expect(saved.rows.length).toBeGreaterThan(0);
      expect(saved.rows.every(row => row.status === 'deleted')).toBe(true);
      expect(await canReadDifyUpload(file)).toBe(false);
      expect(await hasDifyUploadReference(file)).toBe(false);
      expect((await complete(task.execution.id))?.statusCode).toBe(409);
    }
  );
});
