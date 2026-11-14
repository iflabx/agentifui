/** @jest-environment node */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoolClient } from 'pg';

import { AgentPolicyError } from './agent-backends';
import {
  type AgentSubmission,
  admitSubmission,
  confirmSubmission,
  markSubmissionSubmitting,
  registerSubmission,
  rejectSubmission,
  submissionHash,
  submissionId,
  submissionStorage,
} from './agent-submissions';
import { runWithPgSystemContext } from './pg-context';

jest.mock('./pg-context', () => ({ runWithPgSystemContext: jest.fn() }));

const USER = '10000000-0000-4000-8000-000000000001';
const APP = '20000000-0000-4000-8000-000000000001';
const SUBMISSION = '30000000-0000-4000-8000-000000000001';
const PERMISSION = '40000000-0000-4000-8000-000000000001';
const ROOT = '50000000-0000-4000-8000-000000000001';
const fingerprint = submissionHash([APP, 'https://example.invalid', 'app']);
const input = {
  userId: USER,
  serviceInstanceId: APP,
  submissionId: SUBMISSION,
  backendType: 'dify' as const,
  targetFingerprint: fingerprint,
  request: { query: 'synthetic input', inputs: { topic: 'safe' } },
};

describe('atomic task quota and idempotency repository', () => {
  let task: AgentSubmission;
  let used: number;
  let quota: number | null;
  let visibility: string;
  let role: string;
  let permission: boolean;
  let inserted: boolean;
  let baseUrl: string;
  let counts: { user_count: string; app_count: string };
  let query: jest.Mock;
  let client: PoolClient;

  beforeEach(() => {
    jest.clearAllMocks();
    task = {
      root_task_id: ROOT,
      user_id: USER,
      service_instance_id: APP,
      submission_id: SUBMISSION,
      request_hash: submissionHash(input.request),
      target_fingerprint: fingerprint,
      backend_type: 'dify',
      state: 'registered',
      quota_state: 'none',
      quota_permission_id: null,
      run_id: null,
      error_code: null,
    };
    used = 0;
    quota = 1;
    visibility = 'group_only';
    role = 'user';
    permission = true;
    inserted = true;
    baseUrl = 'https://example.invalid';
    counts = { user_count: '0', app_count: '0' };
    query = jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("error_code = 'AGENT_SUBMISSION_EXPIRED'"))
        return { rows: [] };
      if (sql.includes('INSERT INTO agent_submissions'))
        return { rows: inserted ? [{ ...task }] : [] };
      if (sql.startsWith('SELECT * FROM agent_submissions')) {
        if (sql.includes('AND user_id') && params[1] !== USER)
          return { rows: [] };
        return { rows: [{ ...task }] };
      }
      if (sql.includes('SELECT si.visibility'))
        return {
          rows: [
            {
              visibility,
              role,
              config: {},
              base_url: baseUrl,
              instance_id: 'app',
            },
          ],
        };
      if (sql.includes('count(*) FILTER')) return { rows: [counts] };
      if (sql.includes('SELECT gap.id'))
        return {
          rows: permission
            ? [{ id: PERMISSION, usage_quota: quota, used_count: used }]
            : [],
        };
      if (sql.includes('count(*)::text'))
        return {
          rows: [{ count: task.quota_state === 'reserved' ? '1' : '0' }],
        };
      if (sql.includes("SET state = 'admitted'")) {
        task.state = 'admitted';
        task.quota_permission_id = params[1] as string | null;
        task.quota_state = params[2] as AgentSubmission['quota_state'];
      }
      if (sql.includes("SET state = 'submitting'")) {
        if (task.state !== 'admitted') return { rows: [] };
        task.state = 'submitting';
        return { rows: [{ root_task_id: ROOT }] };
      }
      if (
        sql.includes("SET state = 'rejected'") &&
        ['registered', 'admitted'].includes(task.state)
      ) {
        task.state = 'rejected';
        if (task.quota_state === 'reserved') task.quota_state = 'released';
        task.error_code = params[1] as string;
      }
      if (sql.includes('UPDATE group_app_permissions')) {
        used += 1;
        return { rows: [{ id: PERMISSION }] };
      }
      if (sql.includes('SET state = $2')) {
        task.state = params[1] as AgentSubmission['state'];
        if (params[1] !== 'unknown' && task.quota_state === 'reserved')
          task.quota_state = 'counted';
      }
      return { rows: [] };
    });
    client = { query } as unknown as PoolClient;
    jest
      .mocked(runWithPgSystemContext)
      .mockImplementation(async operation => operation(client));
  });

  it('uses canonical complete input, not request ID, as the replay digest', async () => {
    expect(submissionHash({ inputs: { second: 2, first: 1 } })).toBe(
      submissionHash({ inputs: { first: 1, second: 2 } })
    );
    expect(() => submissionId(undefined)).toThrow(
      'AGENT_SUBMISSION_ID_REQUIRED'
    );
    expect((await registerSubmission(input)).replayed).toBe(false);
    inserted = false;
    expect((await registerSubmission(input)).replayed).toBe(true);
    await expect(
      registerSubmission({ ...input, request: { query: 'changed' } })
    ).rejects.toThrow('AGENT_SUBMISSION_MISMATCH');
    await expect(
      registerSubmission({ ...input, targetFingerprint: 'changed' })
    ).rejects.toThrow('AGENT_SUBMISSION_MISMATCH');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "state = 'registered' AND created_at < NOW() - INTERVAL '15 minutes'"
      ),
      [USER]
    );
  });

  it('caps abandoned pre-dispatch registrations without modifying unknown or accepted tasks', async () => {
    query
      .mockImplementationOnce(async () => ({ rows: [] }))
      .mockImplementationOnce(async () => ({ rows: [] }))
      .mockImplementationOnce(async () => ({ rows: [{ count: '8' }] }));
    await expect(registerSubmission(input)).rejects.toThrow(
      'AGENT_REGISTRATION_LIMIT'
    );
    expect(task.state).toBe('registered');
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO'))
    ).toBe(false);
  });

  it('preoccupies quota under the same SQL row lock without charging until acceptance', async () => {
    await admitSubmission(client, ROOT, USER, APP, {});
    expect(used).toBe(0);
    expect(task).toMatchObject({
      state: 'admitted',
      quota_state: 'reserved',
      quota_permission_id: PERMISSION,
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'ORDER BY gap.created_at ASC, gap.id ASC LIMIT 1 FOR UPDATE OF gap'
      ),
      [APP, USER]
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('pg_advisory_xact_lock'),
      [`agent-app:${APP}`]
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("backend_type = 'dify'"),
      [USER, APP]
    );
    await markSubmissionSubmitting(ROOT);
    await confirmSubmission(ROOT, 'accepted');
    await confirmSubmission(ROOT, 'accepted');
    await confirmSubmission(ROOT, 'finished');
    await confirmSubmission(ROOT, 'unknown');
    expect(used).toBe(1);
    expect(task).toMatchObject({ state: 'finished', quota_state: 'counted' });
  });

  it('does not let another admission oversell the final reserved quota', async () => {
    task.quota_state = 'reserved';
    await expect(
      admitSubmission(client, ROOT, USER, APP, {})
    ).rejects.toMatchObject({ statusCode: 429, code: 'AGENT_QUOTA_EXCEEDED' });
    expect(used).toBe(0);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes("SET state = 'admitted'")
      )
    ).toBe(false);
  });

  it('retains unknown reservation and rejects a second dispatch claim', async () => {
    await admitSubmission(client, ROOT, USER, APP, {});
    await markSubmissionSubmitting(ROOT);
    await confirmSubmission(ROOT, 'unknown');
    await rejectSubmission(ROOT, 'late rejection');
    expect(task).toMatchObject({ state: 'unknown', quota_state: 'reserved' });
    await expect(markSubmissionSubmitting(ROOT)).rejects.toThrow(
      'AGENT_SUBMISSION_IN_PROGRESS'
    );
    expect(used).toBe(0);
    await confirmSubmission(ROOT, 'accepted');
    expect(used).toBe(1);
  });

  it('releases a task only when it is known not dispatched', async () => {
    await admitSubmission(client, ROOT, USER, APP, {});
    await rejectSubmission(ROOT, 'CONTENT_MODERATION_BLOCKED');
    await confirmSubmission(ROOT, 'accepted');
    expect(task).toMatchObject({ state: 'rejected', quota_state: 'released' });
    expect(used).toBe(0);
  });

  it('never charges a migrated legacy task when its terminal state is replayed', async () => {
    task.backend_type = 'langchain';
    task.state = 'unknown';
    task.quota_state = 'none';
    await confirmSubmission(ROOT, 'finished');
    await confirmSubmission(ROOT, 'finished');
    expect(task).toMatchObject({ state: 'finished', quota_state: 'none' });
    expect(used).toBe(0);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('UPDATE group_app_permissions')
      )
    ).toBe(false);
  });

  it('follows public/private and unlimited-group SQL semantics', async () => {
    visibility = 'public';
    await admitSubmission(client, ROOT, USER, APP, {});
    expect(task.quota_state).toBe('exempt');
    task.state = 'registered';
    visibility = 'private';
    role = 'admin';
    await admitSubmission(client, ROOT, USER, APP, {});
    expect(task.quota_state).toBe('exempt');
    task.state = 'registered';
    visibility = 'group_only';
    quota = null;
    await admitSubmission(client, ROOT, USER, APP, {});
    expect(task.quota_state).toBe('reserved');
    await confirmSubmission(ROOT, 'accepted');
    expect(used).toBe(1);
  });

  it('does not invent an admin quota bypass or switch away from an exhausted first group', async () => {
    role = 'admin';
    permission = false;
    await expect(admitSubmission(client, ROOT, USER, APP, {})).rejects.toThrow(
      'AGENT_GROUP_PERMISSION_REQUIRED'
    );
    permission = true;
    used = 1;
    await expect(admitSubmission(client, ROOT, USER, APP, {})).rejects.toThrow(
      'AGENT_QUOTA_EXCEEDED'
    );
    expect(
      query.mock.calls.filter(([sql]) => String(sql).includes('SELECT gap.id'))
    ).toHaveLength(2);
  });

  it('refuses wrong ownership, stale configuration, shared capacity and unavailable storage', async () => {
    await expect(
      admitSubmission(client, ROOT, 'other-user', APP, {})
    ).rejects.toThrow('AGENT_SUBMISSION_IN_PROGRESS');
    baseUrl = 'https://changed.invalid';
    await expect(admitSubmission(client, ROOT, USER, APP, {})).rejects.toThrow(
      'AGENT_CONFIG_CHANGED'
    );
    baseUrl = 'https://example.invalid';
    counts.user_count = '1';
    await expect(admitSubmission(client, ROOT, USER, APP, {})).rejects.toThrow(
      'AGENT_CONCURRENCY_LIMIT'
    );
    jest
      .mocked(runWithPgSystemContext)
      .mockRejectedValueOnce(new Error('synthetic storage failure'));
    await expect(registerSubmission(input)).rejects.toThrow(
      'AGENT_GOVERNANCE_UNAVAILABLE'
    );
    await expect(
      submissionStorage(async () => {
        throw new AgentPolicyError(429, 'AGENT_QUOTA_EXCEEDED');
      })
    ).rejects.toThrow('AGENT_QUOTA_EXCEEDED');
  });
});

describe('governance migration guard contracts (not PostgreSQL execution)', () => {
  const migration = readFileSync(
    resolve(
      __dirname,
      '../../../../database/migrations/20261114160000_add_agent_submission_governance.sql'
    ),
    'utf8'
  );
  const functionDefinition = (name: string) => {
    const definition = migration.match(
      new RegExp(`CREATE FUNCTION ${name}\\(\\)[\\s\\S]*?\\$\\$;`)
    )?.[0];
    if (!definition) throw new Error(`Missing migration function ${name}`);
    return definition;
  };

  it('fails busy rather than waiting on application locks while holding configuration row locks', () => {
    const definition = functionDefinition(
      'protect_pending_agent_configuration'
    );
    expect(
      definition.match(/IF NOT pg_try_advisory_xact_lock\(/g)
    ).toHaveLength(2);
    expect(definition).not.toMatch(/\bpg_advisory_xact_lock\(/);
    expect(definition).toContain('ORDER BY si.id LOOP');
    expect(definition.match(/AGENT_CONFIG_BUSY/g)).toHaveLength(4);
  });

  it('rejects reserved permission deletion before FK updates without blocking counted revocation', () => {
    const definition = functionDefinition('protect_reserved_agent_quota');
    const deletion = definition.slice(
      definition.indexOf("IF TG_OP = 'DELETE'"),
      definition.indexOf('IF NEW.used_count')
    );
    expect(deletion).toContain("quota_state = 'reserved'");
    expect(deletion).toContain("RAISE EXCEPTION 'AGENT_QUOTA_BUSY'");
    expect(deletion).toContain('RETURN OLD;');
    expect(deletion).not.toMatch(/counted|FOR UPDATE|NEW\./);
    expect(migration).toContain(
      'BEFORE UPDATE OR DELETE ON group_app_permissions'
    );
    expect(migration).toContain(
      'quota_permission_id UUID REFERENCES group_app_permissions(id) ON DELETE SET NULL'
    );
  });

  it('synchronizes old-API terminal writes only for uncharged migrated LangChain tasks', () => {
    const definition = functionDefinition('finish_legacy_agent_submission');
    for (const guard of [
      'run_id = NEW.id',
      'user_id = NEW.user_id',
      'service_instance_id = NEW.service_instance_id',
      "backend_type = 'langchain'",
      "quota_state = 'none'",
      "state = 'unknown'",
    ]) {
      expect(definition).toContain(guard);
    }
    expect(definition).toContain("SET state = 'finished'");
    expect(definition.split('WHERE')[0]).not.toContain('quota_state');
    expect(definition).not.toContain('group_app_permissions');
    expect(migration).toContain(
      'AFTER UPDATE OF execution_status ON backend_runs'
    );
    expect(migration).toContain(
      "WHEN (NEW.execution_status IN ('success','error','interrupted'))"
    );
  });

  it.each([
    'protect_pending_agent_configuration',
    'protect_reserved_agent_quota',
    'finish_legacy_agent_submission',
  ])(
    'keeps %s system access function-scoped with a fixed search path',
    name => {
      const definition = functionDefinition(name);
      expect(definition).toContain('SET search_path = public, pg_temp');
      expect(definition).toContain("SET app.rls_system_actor = 'true'");
      expect(definition).not.toContain('SECURITY DEFINER');
    }
  );
});
