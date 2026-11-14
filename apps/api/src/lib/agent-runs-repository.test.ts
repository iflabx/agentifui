/** @jest-environment node */
import type { PoolClient } from 'pg';

import { agentConfigFingerprint } from './agent-app';
import {
  AgentRunError,
  type AgentRunRecord,
  bindThread,
  getRunForActor,
  markRunUnknown,
  recordNativeRun,
  reserveRun,
  saveRunResult,
} from './agent-runs-repository';
import { runWithPgSystemContext } from './pg-context';

jest.mock('./pg-context', () => ({ runWithPgSystemContext: jest.fn() }));

const USER = '10000000-0000-4000-8000-000000000001';
const APP = '20000000-0000-4000-8000-000000000001';
const CONVERSATION = '30000000-0000-4000-8000-000000000001';
const SUBMISSION = '40000000-0000-4000-8000-000000000001';
const RUN = '50000000-0000-4000-8000-000000000001';
const USER_MESSAGE = '60000000-0000-4000-8000-000000000001';
const ASSISTANT_MESSAGE = '60000000-0000-4000-8000-000000000002';
const ROOT = '70000000-0000-4000-8000-000000000001';
const BASE_URL = 'https://example.invalid';
const FINGERPRINT = agentConfigFingerprint(APP, BASE_URL, 'agent');
const input = {
  userId: USER,
  serviceInstanceId: APP,
  appInstanceId: 'example-agent',
  configFingerprint: FINGERPRINT,
  submissionId: SUBMISSION,
  content: 'hello',
};

function fixture(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    id: RUN,
    conversation_id: CONVERSATION,
    user_id: USER,
    service_instance_id: APP,
    submission_id: SUBMISSION,
    request_hash:
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    user_message_id: USER_MESSAGE,
    native_run_id: null,
    execution_status: 'reserved',
    persistence_status: 'pending',
    result: null,
    error_code: null,
    created_at: new Date(0),
    updated_at: new Date(0),
    thread_id: null,
    backend_type: 'langchain',
    config_fingerprint: FINGERPRINT,
    user_sequence_index: 0,
    ...overrides,
  };
}

describe('trusted agent run repository', () => {
  let run: AgentRunRecord;
  let replay: boolean;
  let activeProfile: boolean;
  let validBinding: boolean;
  let counts: { user_count: string; app_count: string };
  let failMessageSave: boolean;
  let liveApp: {
    config: { backend_type: string; langchain: { assistant_id: string } };
    base_url: string;
  } | null;
  let query: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    run = fixture();
    replay = false;
    activeProfile = true;
    validBinding = true;
    counts = { user_count: '0', app_count: '0' };
    failMessageSave = false;
    liveApp = {
      config: {
        backend_type: 'langchain',
        langchain: { assistant_id: 'agent' },
      },
      base_url: BASE_URL,
    };
    query = jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM profiles WHERE')) {
        return { rows: activeProfile ? [{ id: USER }] : [] };
      }
      if (sql.includes('WHERE r.user_id ='))
        return { rows: replay ? [run] : [] };
      if (sql.includes('SELECT si.config, p.base_url'))
        return { rows: liveApp ? [liveApp] : [] };
      if (sql.includes('SELECT b.conversation_id')) {
        return {
          rows: validBinding ? [{ conversation_id: CONVERSATION }] : [],
        };
      }
      if (sql.includes('count(*) FILTER')) return { rows: [counts] };
      if (sql.includes('SELECT id FROM backend_runs')) return { rows: [] };
      if (sql.includes('SELECT result =')) {
        return {
          rows: [{ matches: JSON.stringify(run.result) === params[1] }],
        };
      }
      if (sql.includes('SET result =')) {
        run.result = JSON.parse(String(params[1]));
        run.execution_status = params[2] as AgentRunRecord['execution_status'];
      }
      if (sql.includes('SET thread_id =')) run.thread_id = String(params[1]);
      if (sql.includes("SET execution_status = 'submitting'"))
        run.execution_status = 'submitting';
      if (sql.includes('SET native_run_id =')) {
        run.native_run_id = String(params[1]);
        run.execution_status = 'running';
      }
      if (sql.includes("SET execution_status = 'unknown'"))
        run.execution_status = 'unknown';
      if (sql.includes("SET persistence_status = 'saved'"))
        run.persistence_status = 'saved';
      if (sql.includes("SET persistence_status = 'failed'"))
        run.persistence_status = 'failed';
      if (sql.includes('INSERT INTO messages') && sql.includes("'assistant'")) {
        if (failMessageSave) throw new Error('private database error');
        return { rows: [{ id: params[0] }] };
      }
      if (sql.includes('SELECT r.*')) return { rows: [run] };
      return { rows: [] };
    });
    jest
      .mocked(runWithPgSystemContext)
      .mockImplementation(operation =>
        operation({ query } as unknown as PoolClient)
      );
  });

  it('reserves one local conversation and user message after ordered shared locks', async () => {
    const result = await reserveRun(input);
    expect(result.replayed).toBe(false);
    expect(query.mock.calls.slice(0, 2).map(call => call[1])).toEqual([
      [`agent-user:${USER}`],
      [`agent-app:${APP}`],
    ]);
    expect(
      query.mock.calls.filter(call =>
        call[0].includes('INSERT INTO conversations')
      )
    ).toHaveLength(1);
    expect(
      query.mock.calls.find(call =>
        call[0].includes('INSERT INTO conversations')
      )?.[1][3]
    ).toBe(APP);
    expect(
      query.mock.calls.filter(call => call[0].includes('INSERT INTO messages'))
    ).toHaveLength(1);
    expect(
      query.mock.calls.filter(call =>
        call[0].includes('INSERT INTO backend_runs')
      )
    ).toHaveLength(1);
  });

  it('replays the first submission before allocating another conversation or applying active limits', async () => {
    replay = true;
    counts = { user_count: '1', app_count: '2' };
    await expect(reserveRun(input)).resolves.toEqual({ run, replayed: true });
    expect(query.mock.calls.some(call => call[0].includes('INSERT INTO'))).toBe(
      false
    );
    expect(query.mock.calls.some(call => call[0].includes('count(*)'))).toBe(
      false
    );
  });

  it.each(['reserved', 'submitting', 'running', 'unknown'] as const)(
    'links an existing %s run without reserving or charging historical quota',
    async executionStatus => {
      replay = true;
      run.execution_status = executionStatus;
      await expect(
        reserveRun({ ...input, governanceTaskId: ROOT })
      ).resolves.toEqual({ run, replayed: true });
      const lockedRun = query.mock.calls.findIndex(([sql]) =>
        String(sql).includes('WHERE r.user_id =')
      );
      const binding = query.mock.calls.findIndex(([sql]) =>
        String(sql).includes('SELECT b.conversation_id')
      );
      expect(query.mock.calls[lockedRun][0]).toContain('FOR UPDATE OF r');
      expect(lockedRun).toBeLessThan(binding);
      expect(query).toHaveBeenCalledWith(
        expect.stringContaining("state IN ('registered','unknown')"),
        [ROOT, RUN, 'unknown', USER, APP]
      );
      expect(
        query.mock.calls.some(([sql]) =>
          /INSERT INTO|UPDATE group_app_permissions|count\(\*\)/.test(
            String(sql)
          )
        )
      ).toBe(false);
    }
  );

  it.each(['success', 'error', 'interrupted'] as const)(
    'refreshes a migrated task from a now %s run without charging again',
    async executionStatus => {
      replay = true;
      run.execution_status = 'running';
      await reserveRun({ ...input, governanceTaskId: ROOT });
      run.execution_status = executionStatus;
      await reserveRun({ ...input, governanceTaskId: ROOT });
      const updates = query.mock.calls.filter(([sql]) =>
        String(sql).includes('UPDATE agent_submissions')
      );
      expect(updates.map(([, params]) => params)).toEqual([
        [ROOT, RUN, 'unknown', USER, APP],
        [ROOT, RUN, 'finished', USER, APP],
      ]);
      const statement = String(updates[1][0]);
      for (const guard of [
        "backend_type = 'langchain'",
        "quota_state = 'none'",
        'user_id = $4::uuid',
        'service_instance_id = $5::uuid',
        '(run_id IS NULL OR run_id = $2::uuid)',
        "state IN ('registered','unknown')",
      ]) {
        expect(statement).toContain(guard);
      }
      expect(statement.split('WHERE')[0]).not.toContain('quota_state');
      expect(
        query.mock.calls.some(([sql]) =>
          String(sql).includes('UPDATE group_app_permissions')
        )
      ).toBe(false);
    }
  );

  it('rejects changed text or a different local conversation for the same submission', async () => {
    replay = true;
    await expect(
      reserveRun({ ...input, content: 'different' })
    ).rejects.toMatchObject({ code: 'AGENT_SUBMISSION_MISMATCH' });
    await expect(
      reserveRun({ ...input, conversationId: APP })
    ).rejects.toMatchObject({ code: 'AGENT_SUBMISSION_MISMATCH' });
  });

  it('revalidates ownership and configuration for replays', async () => {
    replay = true;
    validBinding = false;
    await expect(reserveRun(input)).rejects.toMatchObject({
      code: 'AGENT_CONVERSATION_UNAVAILABLE',
    });
  });

  it.each([false, true])(
    'rechecks live application ACL before %s replay processing',
    async replayed => {
      replay = replayed;
      liveApp = null;
      await expect(reserveRun(input)).rejects.toMatchObject({
        statusCode: 404,
        code: 'AGENT_APP_NOT_FOUND',
      });
      expect(
        query.mock.calls.some(call => call[0].includes('WHERE r.user_id ='))
      ).toBe(false);
      const checked = query.mock.calls.find(call =>
        call[0].includes('SELECT si.config, p.base_url')
      );
      expect(checked?.[1]).toEqual([APP, USER, input.appInstanceId]);
      for (const clause of [
        "actor.status = 'active'",
        "actor.role = 'admin'",
        'gap.is_enabled = TRUE',
        'gm.user_id = actor.id',
        'p.is_active = TRUE',
        'FOR SHARE OF si, p',
      ]) {
        expect(checked?.[0]).toContain(clause);
      }
    }
  );

  it.each(['backend', 'assistant', 'endpoint'])(
    'rejects changed live %s configuration before an early replay',
    async changed => {
      replay = true;
      if (!liveApp) throw new Error('Missing synthetic app');
      if (changed === 'backend') liveApp.config.backend_type = 'dify';
      if (changed === 'assistant')
        liveApp.config.langchain.assistant_id = 'changed-agent';
      if (changed === 'endpoint')
        liveApp.base_url = 'https://other.example.invalid';
      await expect(reserveRun(input)).rejects.toMatchObject({
        code: 'AGENT_CONFIG_CHANGED',
      });
      expect(
        query.mock.calls.some(call => call[0].includes('WHERE r.user_id ='))
      ).toBe(false);
    }
  );

  it('rejects inactive accounts even for replay', async () => {
    replay = true;
    activeProfile = false;
    await expect(reserveRun(input)).rejects.toMatchObject({ statusCode: 403 });
  });

  it.each([
    { user_count: '1', app_count: '0' },
    { user_count: '0', app_count: '2' },
  ])(
    'enforces user and application limits before any inserts: %j',
    async active => {
      counts = active;
      await expect(reserveRun(input)).rejects.toMatchObject({
        statusCode: 429,
        code: 'AGENT_CONCURRENCY_LIMIT',
      });
      expect(
        query.mock.calls.some(call => call[0].includes('INSERT INTO'))
      ).toBe(false);
      const counted = query.mock.calls.find(call =>
        call[0].includes('count(*) FILTER')
      );
      expect(counted?.[1][2]).toContain('unknown');
    }
  );

  it('does not claim an existing Dify or foreign conversation', async () => {
    validBinding = false;
    await expect(
      reserveRun({ ...input, conversationId: CONVERSATION })
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(
      query.mock.calls.some(call =>
        call[0].includes('INSERT INTO backend_conversations')
      )
    ).toBe(false);
  });

  it('rejects invalid input before obtaining a database transaction', async () => {
    await expect(
      reserveRun({ ...input, userId: 'not-a-uuid' })
    ).rejects.toBeInstanceOf(AgentRunError);
    await expect(
      reserveRun({ ...input, content: 'x'.repeat(16001) })
    ).rejects.toMatchObject({ statusCode: 400 });
    await expect(reserveRun({ ...input, appLimit: 0 })).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(runWithPgSystemContext).not.toHaveBeenCalled();
  });

  it('binds a thread once and records the distinct native run id', async () => {
    await expect(bindThread(RUN, 'thread-one')).resolves.toMatchObject({
      execution_status: 'submitting',
      thread_id: 'thread-one',
    });
    await expect(bindThread(RUN, 'different-thread')).rejects.toMatchObject({
      code: 'AGENT_BINDING_CONFLICT',
    });
    await expect(recordNativeRun(RUN, 'native-run-one')).resolves.toMatchObject(
      { native_run_id: 'native-run-one', execution_status: 'running' }
    );
    await expect(
      recordNativeRun(RUN, 'different-native-run')
    ).rejects.toMatchObject({ code: 'AGENT_RUN_STATE_CONFLICT' });
  });

  it('stores a terminal snapshot before writing assistant history', async () => {
    run = fixture({
      execution_status: 'running',
      thread_id: 'thread-one',
      native_run_id: 'native-one',
    });
    const snapshot = {
      executionStatus: 'success' as const,
      messages: [
        {
          id: ASSISTANT_MESSAGE,
          content: 'answer',
          tools: [{ name: 'arithmetic', result: '4' }],
        },
      ],
    };
    await expect(saveRunResult(RUN, snapshot)).resolves.toMatchObject({
      execution_status: 'success',
      persistence_status: 'saved',
    });
    const statements = query.mock.calls.map(call => call[0] as string);
    expect(
      statements.findIndex(sql => sql.includes('SET result ='))
    ).toBeLessThan(statements.findIndex(sql => sql.includes("'assistant'")));
    expect(runWithPgSystemContext).toHaveBeenCalledTimes(2);
    const inserted = query.mock.calls.find(call =>
      call[0].includes("'assistant'")
    );
    expect(inserted?.[1][0]).toBe(ASSISTANT_MESSAGE);
    expect(inserted?.[1][6]).toBe(1);
    await saveRunResult(RUN, snapshot);
    expect(
      query.mock.calls.filter(call => call[0].includes("'assistant'"))
    ).toHaveLength(1);
  });

  it('rejects successful completion without a trusted native execution identity', async () => {
    await expect(
      saveRunResult(RUN, { executionStatus: 'success', messages: [] })
    ).rejects.toMatchObject({ code: 'AGENT_RUN_STATE_CONFLICT' });
    expect(
      query.mock.calls.some(call => call[0].includes('SET result ='))
    ).toBe(false);
  });

  it('can persist a known pre-execution error without a native execution identity', async () => {
    await expect(
      saveRunResult(RUN, {
        executionStatus: 'error',
        messages: [],
        errorCode: 'AGENT_UPSTREAM_UNAVAILABLE',
      })
    ).resolves.toMatchObject({
      execution_status: 'error',
      persistence_status: 'saved',
    });
  });

  it('retains the saved snapshot on persistence failure and retries saving without generating', async () => {
    run = fixture({
      execution_status: 'running',
      thread_id: 'thread-one',
      native_run_id: 'native-one',
    });
    const snapshot = {
      executionStatus: 'success' as const,
      messages: [{ id: ASSISTANT_MESSAGE, content: 'answer' }],
    };
    failMessageSave = true;
    await expect(saveRunResult(RUN, snapshot)).rejects.toMatchObject({
      code: 'AGENT_STORAGE_UNAVAILABLE',
      message: 'AGENT_STORAGE_UNAVAILABLE',
    });
    expect(run.persistence_status).toBe('failed');
    expect(run.result).toEqual(snapshot);
    failMessageSave = false;
    await expect(saveRunResult(RUN, snapshot)).resolves.toMatchObject({
      persistence_status: 'saved',
    });
    expect(
      query.mock.calls.filter(call => call[0].includes('SET result ='))
    ).toHaveLength(1);
  });

  it('rejects changed results on saving retry', async () => {
    run.result = { executionStatus: 'error', messages: [] };
    await expect(
      saveRunResult(RUN, { executionStatus: 'success', messages: [] })
    ).rejects.toMatchObject({ code: 'AGENT_RESULT_CONFLICT' });
  });

  it('rejects duplicate message ids and unbounded snapshots', async () => {
    await expect(
      saveRunResult(RUN, {
        executionStatus: 'success',
        messages: [
          { id: ASSISTANT_MESSAGE, content: 'one' },
          { id: ASSISTANT_MESSAGE, content: 'two' },
        ],
      })
    ).rejects.toMatchObject({ code: 'INVALID_AGENT_RESULT' });
    await expect(
      saveRunResult(RUN, {
        executionStatus: 'success',
        messages: [{ id: ASSISTANT_MESSAGE, content: 'x'.repeat(1000001) }],
      })
    ).rejects.toMatchObject({ code: 'INVALID_AGENT_RESULT' });
    expect(runWithPgSystemContext).not.toHaveBeenCalled();
  });

  it('keeps unknown execution active instead of claiming cancellation', async () => {
    await expect(markRunUnknown(RUN)).resolves.toMatchObject({
      execution_status: 'unknown',
    });
    run.execution_status = 'success';
    await expect(markRunUnknown(RUN)).resolves.toMatchObject({
      execution_status: 'success',
    });
  });

  it('scopes run reads to the active profile, owner, application and visible conversation', async () => {
    await expect(getRunForActor(RUN, USER, APP)).resolves.toBe(run);
    const call = query.mock.calls[0];
    expect(call[1]).toEqual([RUN, USER, APP]);
    expect(call[0]).toContain("p.status = 'active'");
    expect(call[0]).toContain('c.user_id = $2::uuid');
    expect(call[0]).toContain('r.service_instance_id = $3::uuid');
  });

  it('maps storage failures to a safe error without database details', async () => {
    query.mockRejectedValueOnce(new Error('postgresql://private-secret'));
    await expect(reserveRun(input)).rejects.toMatchObject({
      statusCode: 503,
      message: 'AGENT_STORAGE_UNAVAILABLE',
    });
  });
});
