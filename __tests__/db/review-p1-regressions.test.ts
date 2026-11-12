/** @jest-environment node */
import { auth } from '@lib/auth/better-auth/server';
import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { resolveInternalUserId } from '@lib/auth/better-auth/session-identity/persistence/identity';
import { ensureProfileStatus } from '@lib/auth/better-auth/session-identity/persistence/profile-status';
import { getPgPool as getWebPool } from '@lib/server/pg/pool';
import { dataService } from '@lib/services/db/data-service';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { getPgPool as getApiPool } from '../../apps/api/src/lib/pg-context';
import { handleMessageAction } from '../../apps/api/src/routes/internal-data-route/message-actions';
import { handleUserAction } from '../../apps/api/src/routes/internal-data-route/user-actions';
import { resolveTestDatabaseUrl } from './helpers/test-database-url';

jest.mock('@lib/auth/better-auth/server', () => ({
  auth: { api: { getSession: jest.fn() } },
  getAuthProviderIssuer: jest.fn(),
}));
jest.mock(
  '@lib/auth/better-auth/session-identity/persistence/publisher',
  () => ({
    publishProfileChangeBestEffort: jest.fn(),
  })
);

jest.setTimeout(30000);

let pool: Pool;
let userId: string;
let conversationId: string;
let email: string;
const administratorId = randomUUID();
const originalPoolMax = process.env.PG_POOL_MAX;

beforeAll(() => {
  process.env.PG_POOL_MAX = '1';
  process.env.DATABASE_URL = resolveTestDatabaseUrl();
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});

beforeEach(async () => {
  jest.clearAllMocks();
  userId = randomUUID();
  conversationId = randomUUID();
  email = `${userId}@example.invalid`;
  await pool.query(
    'INSERT INTO auth_users (id, name, email) VALUES ($1, $2, $3)',
    [userId, 'Review User', email]
  );
  await pool.query('INSERT INTO profiles (id, email) VALUES ($1, $2)', [
    userId,
    email,
  ]);
  await pool.query(
    'INSERT INTO conversations (id, user_id, title) VALUES ($1, $2, $3)',
    [conversationId, userId, 'Pagination fixture']
  );
});

afterEach(async () => {
  await pool.query('DELETE FROM profiles WHERE id = $1', [userId]);
  await pool.query('DELETE FROM auth_users WHERE id = $1', [userId]);
});

afterAll(async () => {
  dataService.destroy();
  await Promise.all([pool.end(), getApiPool().end(), getWebPool().end()]);
  const state = globalThis as unknown as Record<string, unknown>;
  delete state.__agentifui_fastify_pg_pool__;
  delete state.__agentifui_pg_pool__;
  if (originalPoolMax === undefined) delete process.env.PG_POOL_MAX;
  else process.env.PG_POOL_MAX = originalPoolMax;
});

async function countUserRows(table: 'profiles' | 'auth_users') {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS total FROM ${table} WHERE id = $1`,
    [userId]
  );
  return result.rows[0].total;
}

async function waitForAccountLock() {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const waiting = await pool.query(`
      SELECT 1 FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'
        AND query LIKE 'SELECT id::text FROM auth_users%FOR KEY SHARE'
    `);
    if (waiting.rows.length) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Identity synchronization did not wait for the account lock');
}

describe('account deletion and stale identities', () => {
  it('rejects concurrent unmapped legacy identities with a single-connection pool without creating accounts or mappings', async () => {
    const subjects = Array.from(
      { length: 6 },
      (_, index) => `legacy-test-${userId}-${index % 3}`
    );
    const results = await Promise.all(
      subjects.map(id => resolveInternalUserId(id, { id, email }))
    );
    for (const result of results) {
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.message).toBe(
          'Authentication account no longer exists'
        );
    }
    const mapped = await pool.query(
      'SELECT 1 FROM user_identities WHERE subject = ANY($1::text[])',
      [subjects]
    );
    expect(mapped.rows).toHaveLength(0);
    expect(await countUserRows('profiles')).toBe(1);
    expect(await countUserRows('auth_users')).toBe(1);
  });

  it('removes authentication records and rejects a cached identity without rebuilding its profile', async () => {
    await pool.query(
      `INSERT INTO auth_accounts (user_id, account_id, provider_id, password)
      VALUES ($1, $2, 'credential', 'test-only-unusable-hash')`,
      [userId, userId]
    );
    await pool.query(
      `INSERT INTO auth_sessions (user_id, token, expires_at)
      VALUES ($1, $2, NOW() + interval '1 hour')`,
      [userId, randomUUID()]
    );
    await pool.query(
      `INSERT INTO messages (conversation_id, role, content) VALUES ($1, 'user', 'test')`,
      [conversationId]
    );
    expect(
      (await handleUserAction('users.deleteUser', { userId }, administratorId))
        ?.statusCode
    ).toBe(200);
    expect(await countUserRows('profiles')).toBe(0);
    expect(await countUserRows('auth_users')).toBe(0);
    for (const table of ['auth_accounts', 'auth_sessions', 'conversations']) {
      const remaining = await pool.query(
        `SELECT COUNT(*)::int AS total FROM ${table} WHERE user_id = $1`,
        [userId]
      );
      expect(remaining.rows[0].total).toBe(0);
    }
    const messages = await pool.query(
      'SELECT 1 FROM messages WHERE conversation_id = $1',
      [conversationId]
    );
    expect(messages.rows).toHaveLength(0);
    jest.mocked(auth.api.getSession).mockResolvedValue({
      session: { id: 'stale-session' },
      user: { id: userId, email, name: 'Cached User' },
    } as never);
    expect(await resolveSessionIdentity(new Headers())).toEqual({
      success: true,
      data: null,
    });
    expect(await countUserRows('profiles')).toBe(0);
  });

  it('still creates a profile for an existing newly registered authentication account', async () => {
    await pool.query('DELETE FROM profiles WHERE id = $1', [userId]);
    const result = await ensureProfileStatus(userId, {
      id: userId,
      email,
      name: 'New User',
    });
    expect(result).toMatchObject({
      success: true,
      data: { created: true, status: 'active' },
    });
    expect(await countUserRows('profiles')).toBe(1);
  });

  it('rolls back profile and business deletion when authentication deletion fails', async () => {
    const guardTable = `test_account_guard_${userId.replaceAll('-', '')}`;
    await pool.query(
      `CREATE TABLE ${guardTable} (user_id uuid REFERENCES auth_users(id))`
    );
    try {
      await pool.query(`INSERT INTO ${guardTable} VALUES ($1)`, [userId]);
      await expect(
        handleUserAction('users.deleteUser', { userId }, administratorId)
      ).rejects.toThrow();
      expect(await countUserRows('profiles')).toBe(1);
      expect(await countUserRows('auth_users')).toBe(1);
      expect(
        (
          await pool.query('SELECT 1 FROM conversations WHERE id = $1', [
            conversationId,
          ])
        ).rows
      ).toHaveLength(1);
    } finally {
      await pool.query(`DROP TABLE ${guardTable}`);
    }
  });

  it('cannot recreate a profile when account deletion commits during identity synchronization', async () => {
    const deleting = await pool.connect();
    let pending: ReturnType<typeof ensureProfileStatus> | undefined;
    try {
      await deleting.query('BEGIN');
      await deleting.query(
        'SELECT id FROM auth_users WHERE id = $1 FOR UPDATE',
        [userId]
      );
      pending = ensureProfileStatus(userId, { id: userId, email });
      await waitForAccountLock();
      await deleting.query('DELETE FROM profiles WHERE id = $1', [userId]);
      await deleting.query('DELETE FROM auth_users WHERE id = $1', [userId]);
      await deleting.query('COMMIT');
      expect((await pending).success).toBe(false);
      expect(await countUserRows('profiles')).toBe(0);
    } finally {
      await deleting.query('ROLLBACK');
      deleting.release();
      await pending;
    }
  });
});

describe('database-backed message pagination', () => {
  it.each([0, 19, 20, 21, 1001])(
    'loads all %i messages without omissions, reordering or duplicates',
    async total => {
      await pool.query(
        `
      INSERT INTO messages (conversation_id, role, content, created_at, sequence_index)
      SELECT $1::uuid, 'user', position::text,
        '2026-01-01 00:00:00.000001+00'::timestamptz + (position % 3) * interval '1 microsecond',
        position % 2
      FROM generate_series(1, $2::int) AS position
    `,
        [conversationId, total]
      );
      const expected = await pool.query(
        `SELECT id::text FROM messages WHERE conversation_id = $1
      ORDER BY created_at ASC, COALESCE(sequence_index, 0) ASC, id ASC`,
        [conversationId]
      );
      const expectedIds = expected.rows.map(row => row.id);
      let beforeMessageId: string | undefined;
      let loaded: string[] = [];
      let pages = 0;
      while (true) {
        const response = await handleMessageAction(
          'messages.getPage',
          { conversationId, limit: 20, beforeMessageId },
          userId
        );
        const payload = response?.payload as {
          data: {
            messages: { id: string }[];
            hasMore: boolean;
            nextCursor: string | null;
          };
        };
        const page = payload.data;
        if (pages === 0)
          expect(page.messages.map(item => item.id)).toEqual(
            expectedIds.slice(-20)
          );
        expect(page.messages.length).toBeLessThanOrEqual(20);
        loaded = [...page.messages.map(item => item.id), ...loaded];
        pages += 1;
        if (!page.hasMore) {
          expect(page.nextCursor).toBeNull();
          break;
        }
        expect(page.nextCursor).toBe(page.messages[0].id);
        beforeMessageId = page.nextCursor!;
        if (pages > Math.ceil(total / 20))
          throw new Error('Pagination did not terminate');
      }
      expect(loaded).toEqual(expectedIds);
      expect(new Set(loaded).size).toBe(total);
      const latest = await handleMessageAction(
        'messages.getLatest',
        { conversationId, limit: 20 },
        userId
      );
      expect(
        (latest?.payload as { data: { id: string }[] }).data.map(
          item => item.id
        )
      ).toEqual(expectedIds.slice(-20));
    }
  );

  it('does not let a foreign cursor or actor expose another conversation', async () => {
    const foreignMessage = await pool.query(
      `INSERT INTO messages (conversation_id, role, content)
      VALUES ($1, 'user', 'private') RETURNING id::text`,
      [conversationId]
    );
    expect(
      (
        await handleMessageAction(
          'messages.getPage',
          { conversationId },
          administratorId
        )
      )?.statusCode
    ).toBe(404);
    const emptyConversation = randomUUID();
    await pool.query(
      "INSERT INTO conversations (id, user_id, title) VALUES ($1, $2, 'Empty fixture')",
      [emptyConversation, userId]
    );
    const response = await handleMessageAction(
      'messages.getPage',
      {
        conversationId: emptyConversation,
        beforeMessageId: foreignMessage.rows[0].id,
      },
      userId
    );
    expect(response?.payload).toMatchObject({
      data: { messages: [], hasMore: false },
    });
  });
});
