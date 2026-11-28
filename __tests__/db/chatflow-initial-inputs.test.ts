/** @jest-environment node */
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { getPgPool } from '../../apps/api/src/lib/pg-context';
import { handleMessageAction } from '../../apps/api/src/routes/internal-data-route/message-actions';
import { resolveTestDatabaseUrl } from './helpers/test-database-url';
import { createTestRole, dropTestRole } from './helpers/test-role';

const actor = randomUUID();
const provider = randomUUID();
const application = randomUUID();
const group = randomUUID();
const conversations = [randomUUID(), randomUUID()];
const name = `chatflow-initial-${randomUUID()}`;
const role = `chatflow_initial_${randomUUID().replaceAll('-', '')}`;
const original = { ...process.env };
let database: Pool;

beforeAll(async () => {
  database = new Pool({ connectionString: resolveTestDatabaseUrl() });
  await createTestRole(database, role);
  await database.query(
    'INSERT INTO auth_users(id,name,email) VALUES($1,$2,$3)',
    [actor, name, `${actor}@example.invalid`]
  );
  await database.query(
    "INSERT INTO profiles(id,email,role,status) VALUES($1,$2,'user','active')",
    [actor, `${actor}@example.invalid`]
  );
  await database.query(
    "INSERT INTO providers(id,name,type,base_url,auth_type,is_active) VALUES($1,$2,'dify','https://example.invalid','bearer',true)",
    [provider, name]
  );
  await database.query(
    "INSERT INTO service_instances(id,provider_id,instance_id,visibility,config) VALUES($1,$2,$3,'group_only','{}')",
    [application, provider, name]
  );
  await database.query('INSERT INTO groups(id,name) VALUES($1,$2)', [
    group,
    name,
  ]);
  await database.query(
    'INSERT INTO group_members(group_id,user_id) VALUES($1,$2)',
    [group, actor]
  );
  await database.query(
    'INSERT INTO group_app_permissions(group_id,service_instance_id,is_enabled) VALUES($1,$2,true)',
    [group, application]
  );
  for (const [index, conversation] of conversations.entries()) {
    await database.query(
      "INSERT INTO conversations(id,user_id,app_id,title,status) VALUES($1,$2,$3,'Synthetic native Chatflow','active')",
      [conversation, actor, index ? name : application]
    );
    await database.query(
      "INSERT INTO messages(conversation_id,user_id,role,content,metadata,created_at) VALUES($1,$2,'user','Hidden original initial question',$3,NOW()-INTERVAL '1 day')",
      [
        conversation,
        actor,
        JSON.stringify({
          edit_hidden: true,
          chatflow_initial_inputs: {
            topic: 'original fixed topic',
            count: 0,
            upload: { upload_file_id: 'not-visible-in-summary' },
          },
        }),
      ]
    );
    await database.query(
      "INSERT INTO messages(conversation_id,user_id,role,content) SELECT $1,$2,CASE WHEN item % 2 = 0 THEN 'assistant'::message_role ELSE 'user'::message_role END,'Synthetic later turn' FROM generate_series(1,24) item",
      [conversation, actor]
    );
  }
  const scoped = new URL(resolveTestDatabaseUrl());
  scoped.searchParams.set(
    'options',
    `-c role=${role} -c app.rls_strict_mode=on`
  );
  process.env.DATABASE_URL = scoped.toString();
  process.env.APP_RLS_STRICT_MODE = 'true';
}, 30000);

beforeEach(async () => {
  await database.query('UPDATE providers SET is_active=true WHERE id=$1', [
    provider,
  ]);
  await database.query(
    'UPDATE group_app_permissions SET is_enabled=true WHERE group_id=$1 AND service_instance_id=$2',
    [group, application]
  );
  await database.query(
    "UPDATE conversations SET status='active' WHERE id=ANY($1::uuid[])",
    [conversations]
  );
});

afterAll(async () => {
  const state = globalThis as Record<string, unknown>;
  if (state.__agentifui_fastify_pg_pool__) await getPgPool().end();
  delete state.__agentifui_fastify_pg_pool__;
  if (database) {
    await database.query('DELETE FROM conversations WHERE id=ANY($1::uuid[])', [
      conversations,
    ]);
    await database.query('DELETE FROM groups WHERE id=$1', [group]);
    await database.query('DELETE FROM providers WHERE id=$1', [provider]);
    await database.query('DELETE FROM profiles WHERE id=$1', [actor]);
    await database.query('DELETE FROM auth_users WHERE id=$1', [actor]);
    await dropTestRole(database, role);
    await database.end();
  }
  for (const key of ['DATABASE_URL', 'APP_RLS_STRICT_MODE']) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

it.each([0, 1])(
  'restores the hidden original initialization beyond the latest message window (app id variant %s)',
  async index => {
    const response = await handleMessageAction(
      'messages.getChatflowInitialInputs',
      { conversationId: conversations[index] },
      actor
    );
    expect(response?.payload).toEqual({
      success: true,
      data: { topic: 'original fixed topic', count: 0 },
    });
  }
);

it.each(['permission', 'provider', 'deleted', 'other-actor'])(
  'denies native summary access after %s changes without a backend binding',
  async kind => {
    if (kind === 'permission')
      await database.query(
        'UPDATE group_app_permissions SET is_enabled=false WHERE group_id=$1',
        [group]
      );
    if (kind === 'provider')
      await database.query('UPDATE providers SET is_active=false WHERE id=$1', [
        provider,
      ]);
    if (kind === 'deleted')
      await database.query(
        "UPDATE conversations SET status='deleted' WHERE id=ANY($1::uuid[])",
        [conversations]
      );
    for (const conversationId of conversations) {
      const response = await handleMessageAction(
        'messages.getChatflowInitialInputs',
        { conversationId },
        kind === 'other-actor' ? randomUUID() : actor
      );
      expect(response?.statusCode).toBe(404);
    }
  }
);

it('finds older saved messages, paginates tied timestamps and opens the exact message', async () => {
  const allHits: string[] = [];
  let beforeMessageId: string | undefined;
  for (const expectedCount of [20, 20, 8]) {
    const response = await handleMessageAction(
      'messages.searchHistory',
      { query: 'LaTeR TuRn', beforeMessageId },
      actor
    );
    expect(response?.statusCode).toBe(200);
    const data = (
      response?.payload as {
        data: {
          hits: { id: string; conversationId: string; snippet: string }[];
          nextCursor: string | null;
        };
      }
    ).data;
    expect(data.hits).toHaveLength(expectedCount);
    allHits.push(...data.hits.map(hit => hit.id));
    const { id, conversationId } = data.hits.at(-1)!;
    const match = await handleMessageAction(
      'messages.getHistoryMatch',
      { conversationId, messageId: id },
      actor
    );
    expect(match?.payload).toMatchObject({
      success: true,
      data: { id, conversationId, content: 'Synthetic later turn' },
    });
    beforeMessageId = data.nextCursor ?? undefined;
  }
  expect(new Set(allHits).size).toBe(48);
  expect(beforeMessageId).toBeUndefined();
});

it('does not search removed revisions, pending edits or SQL wildcard patterns', async () => {
  const pendingId = randomUUID();
  await database.query(
    `INSERT INTO messages(id,conversation_id,user_id,role,content,metadata)
      VALUES ($1,$2,$3,'user','Pending revision 只在测试出现','{"edit_pending":true}')`,
    [pendingId, conversations[0], actor]
  );
  try {
    for (const query of ['Hidden original', '只在测试出现', '%_']) {
      const response = await handleMessageAction(
        'messages.searchHistory',
        { query },
        actor
      );
      expect(response?.payload).toEqual({
        success: true,
        data: { hits: [], nextCursor: null },
      });
    }
    const match = await handleMessageAction(
      'messages.getHistoryMatch',
      { conversationId: conversations[0], messageId: pendingId },
      actor
    );
    expect(match?.statusCode).toBe(404);
  } finally {
    await database.query('DELETE FROM messages WHERE id=$1', [pendingId]);
  }
});

it('loads a bounded window around a saved hit without including hidden revisions', async () => {
  const conversationId = conversations[0];
  const { rows } = await database.query<{ id: string }>(
    `SELECT id FROM messages WHERE conversation_id=$1 AND content='Synthetic later turn'
     ORDER BY created_at, coalesce(sequence_index,0), id`,
    [conversationId]
  );
  for (const position of [0, 10]) {
    const messageId = rows[position].id;
    const response = await handleMessageAction(
      'messages.getHistoryMatch',
      { conversationId, messageId, includeNearby: true },
      actor
    );
    expect(response?.payload).toMatchObject({
      success: true,
      data: {
        id: messageId,
        nearby: rows.slice(Math.max(0, position - 5), position + 6),
      },
    });
  }
});

it('rechecks ownership, application permission and deletion for search and direct links', async () => {
  const conversationId = conversations[1];
  const { rows } = await database.query<{ id: string }>(
    "SELECT id FROM messages WHERE conversation_id=$1 AND content='Synthetic later turn' LIMIT 1",
    [conversationId]
  );
  const messageId = rows[0].id;
  async function expectInaccessible(viewer: string) {
    const search = await handleMessageAction(
      'messages.searchHistory',
      { query: 'later turn' },
      viewer
    );
    expect(search?.payload).toEqual({
      success: true,
      data: { hits: [], nextCursor: null },
    });
    const match = await handleMessageAction(
      'messages.getHistoryMatch',
      { conversationId, messageId },
      viewer
    );
    expect(match?.statusCode).toBe(404);
  }
  await expectInaccessible(randomUUID());
  await database.query(
    'UPDATE group_app_permissions SET is_enabled=false WHERE group_id=$1',
    [group]
  );
  await expectInaccessible(actor);
  await database.query(
    'UPDATE group_app_permissions SET is_enabled=true WHERE group_id=$1',
    [group]
  );
  await database.query(
    "UPDATE conversations SET status='deleted' WHERE id=ANY($1::uuid[])",
    [conversations]
  );
  await expectInaccessible(actor);
});
