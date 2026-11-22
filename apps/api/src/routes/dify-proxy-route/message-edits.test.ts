/** @jest-environment node */
import {
  activateMessageEdit,
  messageEditHash,
  resolveMessageEdit,
} from '../../lib/message-edits';
import { runWithPgSystemContext } from '../../lib/pg-context';
import {
  type DifyMessageEdit,
  acceptDifyMessageEdit,
  resolveDifyMessageEdit,
  sanitizeDifyMessageHistory,
  stageDifyMessageEdit,
} from './message-edits';
import type { DifyProxyRequestContext, DifyProxyTargetConfig } from './types';

jest.mock('../../lib/pg-context', () => ({
  runWithPgSystemContext: jest.fn(),
}));
jest.mock('../../lib/message-edits', () => ({
  ...jest.requireActual('../../lib/message-edits'),
  resolveMessageEdit: jest.fn(),
  activateMessageEdit: jest.fn().mockResolvedValue(undefined),
}));

const conversationId = '10000000-0000-4000-8000-000000000001';
const sourceId = '20000000-0000-4000-8000-000000000001';
const messageId = '30000000-0000-4000-8000-000000000001';
const context: DifyProxyRequestContext = {
  appId: 'app',
  slug: ['chat-messages'],
  routePath: '/api/dify/app/chat-messages',
  actor: { userId: '40000000-0000-4000-8000-000000000001', role: 'user' },
};
const edit: DifyMessageEdit = {
  userId: context.actor.userId,
  conversationId,
  sourceId,
  clientMessageId: 'msg-1700000000000-aBc',
  externalConversationId: 'native-conversation',
  content: 'new request',
  upstreamContent: 'hidden server instruction',
  messageId,
};
const target: DifyProxyTargetConfig = {
  serviceInstanceId: '50000000-0000-4000-8000-000000000001',
  difyApiUrl: 'https://dify.example/v1',
  difyApiKey: 'key',
  appType: 'chatbot',
  tempConfigUsed: false,
  rawBody: {
    editSourceId: sourceId,
    editMessageId: edit.clientMessageId,
    conversation_id: edit.externalConversationId,
    query: edit.content,
  },
};
const query = jest.fn();
const client = { query };

interface LocalMessage {
  id: string;
  role: string;
  content: string;
  external_id: string | null;
  metadata: Record<string, unknown>;
}

function local(overrides: Partial<LocalMessage> = {}): LocalMessage {
  return {
    id: messageId,
    role: 'user',
    content: edit.content,
    external_id: 'native-new',
    metadata: {
      edit_source_id: sourceId,
      edit_upstream_hash: messageEditHash(edit.upstreamContent),
    },
    ...overrides,
  };
}

function history(data: unknown[], hasMore = false) {
  return { data, has_more: hasMore, limit: 20 };
}

function databaseMessages(rows: ReturnType<typeof local>[]) {
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('JOIN service_instances'))
      return { rows: [{ id: conversationId, has_edits: true }] };
    if (sql.includes('SELECT id::text, role::text')) return { rows };
    return { rows: [], rowCount: 1 };
  });
}

describe('legacy Dify message edits', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    query.mockReset();
    query.mockResolvedValue({ rows: [{ id: conversationId }], rowCount: 1 });
    jest
      .mocked(runWithPgSystemContext)
      .mockImplementation(async operation => operation(client as never));
    jest.mocked(resolveMessageEdit).mockResolvedValue(edit);
    jest.mocked(activateMessageEdit).mockResolvedValue(undefined);
  });

  it('accepts the actual non-UUID, case-sensitive frontend identity and verifies app ownership', async () => {
    const resolved = await resolveDifyMessageEdit(
      context,
      target,
      'POST',
      'chat-messages'
    );
    expect(resolved?.clientMessageId).toBe('msg-1700000000000-aBc');
    expect(query.mock.calls[0][1]).toEqual([
      edit.externalConversationId,
      edit.userId,
      target.serviceInstanceId,
    ]);
    expect(query.mock.calls[0][0]).toContain(
      'conversation.app_id = instance.instance_id'
    );
    expect(query.mock.calls[0][0]).toContain('NOT EXISTS');
    expect(resolveMessageEdit).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId, content: edit.content }),
      client
    );
  });

  it.each(['', '  ', 'x'.repeat(256)])(
    'rejects an empty or unbounded client identity',
    async editMessageId => {
      await expect(
        resolveDifyMessageEdit(
          context,
          {
            ...target,
            rawBody: { ...(target.rawBody as object), editMessageId },
          },
          'POST',
          'chat-messages'
        )
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(query).not.toHaveBeenCalled();
    }
  );

  it.each([
    { tempConfigUsed: true },
    { appType: 'workflow' },
    { appType: 'text-generation' },
  ])(
    'does not allow edit contract on unsupported targets: %j',
    async override => {
      await expect(
        resolveDifyMessageEdit(
          context,
          { ...target, ...override },
          'POST',
          'chat-messages'
        )
      ).rejects.toMatchObject({ statusCode: 400 });
    }
  );

  it('leaves ordinary sends unchanged and rejects foreign conversations', async () => {
    expect(
      await resolveDifyMessageEdit(
        context,
        { ...target, rawBody: { query: 'normal' } },
        'POST',
        'chat-messages'
      )
    ).toBeUndefined();
    query.mockResolvedValue({ rows: [] });
    await expect(
      resolveDifyMessageEdit(context, target, 'POST', 'chat-messages')
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it.each([{ rows: [] }, { rows: [{ id: conversationId, has_edits: false }] }])(
    'preserves ordinary native history without local edits: %j',
    async ({ rows }) => {
      query.mockResolvedValue({ rows });
      const original = history([
        { id: 'native-old', query: 'ordinary', answer: 'unchanged' },
      ]);
      expect(
        await sanitizeDifyMessageHistory(
          original,
          edit.externalConversationId,
          context,
          target
        )
      ).toEqual(original);
      expect(query).toHaveBeenCalledTimes(1);
    }
  );

  it('binds an early frontend save without overwriting its attachment metadata or activating it', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: messageId,
            content: edit.content,
            metadata: { attachments: [{ id: 'file' }] },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    expect((await stageDifyMessageEdit(edit, 'root')).messageId).toBe(
      messageId
    );
    expect(query.mock.calls[1][1]).toEqual([
      conversationId,
      edit.userId,
      edit.clientMessageId,
    ]);
    expect(query.mock.calls[2][0]).toContain(
      "COALESCE(metadata, '{}'::jsonb) || $2::jsonb"
    );
    const staged = JSON.parse(query.mock.calls[2][1][1]);
    expect(staged).toMatchObject({
      client_message_id: edit.clientMessageId,
      edit_pending: true,
      edit_pending_source_id: sourceId,
    });
    expect(staged).not.toHaveProperty('edit_source_id');
    expect(staged).not.toHaveProperty('attachments');
    expect(activateMessageEdit).not.toHaveBeenCalled();
  });

  it('inserts only visible content if the frontend save has not arrived', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: messageId }] });
    await stageDifyMessageEdit(edit, 'root');
    const [sql, params] = query.mock.calls[2];
    expect(sql).toContain('INSERT INTO messages');
    expect(params[2]).toBe(edit.content);
    expect(JSON.stringify(params)).not.toContain(edit.upstreamContent);
  });

  it('rejects reuse of a client identity for different content', async () => {
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [{ id: messageId, content: 'different', metadata: {} }],
    });
    await expect(stageDifyMessageEdit(edit, 'root')).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('requires native identity and matching conversation before activation', async () => {
    await acceptDifyMessageEdit(edit, {});
    expect(activateMessageEdit).not.toHaveBeenCalled();
    await expect(
      acceptDifyMessageEdit(edit, {
        message_id: 'native-new',
        conversation_id: 'foreign',
      })
    ).rejects.toMatchObject({ code: 'MESSAGE_EDIT_BINDING_MISMATCH' });
    expect(activateMessageEdit).not.toHaveBeenCalled();
    await acceptDifyMessageEdit(edit, {
      message_id: 'native-new',
      conversation_id: edit.externalConversationId,
    });
    expect(activateMessageEdit).toHaveBeenCalledWith(
      client,
      conversationId,
      sourceId,
      messageId
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('external_id = $2'),
      [messageId, 'native-new']
    );
  });

  it('activates at trusted Chatflow task acceptance even before a message identity arrives', async () => {
    await acceptDifyMessageEdit(edit, {
      event: 'workflow_started',
      task_id: 'task',
    });
    expect(activateMessageEdit).toHaveBeenCalledWith(
      client,
      conversationId,
      sourceId,
      messageId
    );
    expect(query).not.toHaveBeenCalled();
  });

  it('replaces hidden prompt queries using mappings outside the current page and preserves files', async () => {
    databaseMessages([local()]);
    const files = [{ id: 'file' }];
    const result = await sanitizeDifyMessageHistory(
      history([
        {
          id: 'native-new',
          query: edit.upstreamContent,
          inputs: { query: edit.upstreamContent },
          answer: 'answer',
          message_files: files,
        },
      ]),
      edit.externalConversationId,
      context,
      target
    );
    expect(result).toMatchObject({
      data: [
        {
          query: edit.content,
          inputs: { query: edit.content },
          answer: 'answer',
          message_files: files,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(edit.upstreamContent);
  });

  it('matches old hidden user messages through their assistant native identity and filters them', async () => {
    databaseMessages([
      local({
        id: sourceId,
        content: 'old',
        external_id: null,
        metadata: { edit_hidden: true },
      }),
      local({
        id: 'assistant',
        role: 'assistant',
        content: 'old answer',
        external_id: 'native-old',
        metadata: { edit_hidden: true },
      }),
      local(),
    ]);
    const result = await sanitizeDifyMessageHistory(
      history([
        { id: 'native-new', query: edit.upstreamContent },
        { id: 'native-old', query: 'old' },
      ]),
      edit.externalConversationId,
      context,
      target
    );
    expect(result).toMatchObject({
      data: [{ id: 'native-new', query: edit.content }],
      has_more: false,
    });
  });

  it('reconciles pending acceptance then reloads hidden flags before filtering the same page', async () => {
    const rows = [
      local({
        id: sourceId,
        content: 'old',
        external_id: 'native-old',
        metadata: {},
      }),
      local({
        external_id: null,
        metadata: {
          edit_pending: true,
          edit_pending_source_id: sourceId,
          edit_upstream_hash: messageEditHash(edit.upstreamContent),
        },
      }),
    ];
    databaseMessages(rows);
    jest.mocked(activateMessageEdit).mockImplementationOnce(async () => {
      rows[0].metadata = { edit_hidden: true };
      rows[1].metadata = {
        edit_source_id: sourceId,
        edit_upstream_hash: messageEditHash(edit.upstreamContent),
      };
    });
    const result = await sanitizeDifyMessageHistory(
      history([
        { id: 'native-old', query: 'old' },
        { id: 'native-new', query: edit.upstreamContent },
      ]),
      edit.externalConversationId,
      context,
      target
    );
    expect(activateMessageEdit).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      data: [{ id: 'native-new', query: edit.content }],
    });
    expect(
      query.mock.calls.filter(([sql]) =>
        sql.includes('SELECT id::text, role::text')
      ).length
    ).toBeGreaterThan(1);
  });

  it('skips all-hidden native pages until a visible page, never returning empty data with has_more', async () => {
    databaseMessages([
      local({
        id: sourceId,
        content: 'old',
        external_id: 'native-old',
        metadata: { edit_hidden: true },
      }),
      local({
        id: 'earlier',
        content: 'earlier',
        external_id: 'native-earlier',
        metadata: {},
      }),
    ]);
    const loadPage = jest
      .fn()
      .mockResolvedValue(history([{ id: 'native-earlier', query: 'earlier' }]));
    const result = await sanitizeDifyMessageHistory(
      history([{ id: 'native-old', query: 'old' }], true),
      edit.externalConversationId,
      context,
      target,
      loadPage
    );
    expect(loadPage).toHaveBeenCalledWith('native-old');
    expect(result).toMatchObject({
      data: [{ id: 'native-earlier' }],
      has_more: false,
    });
  });

  it('returns a true terminal empty page only when the native history is exhausted', async () => {
    databaseMessages([
      local({
        id: sourceId,
        content: 'old',
        external_id: 'native-old',
        metadata: { edit_hidden: true },
      }),
    ]);
    expect(
      await sanitizeDifyMessageHistory(
        history([{ id: 'native-old', query: 'old' }]),
        edit.externalConversationId,
        context,
        target
      )
    ).toMatchObject({ data: [], has_more: false });
  });

  it('fails closed on cyclic pagination, unmapped edited history or malformed history', async () => {
    databaseMessages([local({ metadata: { edit_hidden: true } })]);
    await expect(
      sanitizeDifyMessageHistory(
        history([{ id: 'native-new', query: edit.content }], true),
        edit.externalConversationId,
        context,
        target,
        jest.fn(),
        'native-new'
      )
    ).rejects.toMatchObject({ code: 'DIFY_HISTORY_PAGINATION_UNAVAILABLE' });
    await expect(
      sanitizeDifyMessageHistory(
        history([{ id: 'unknown', query: edit.upstreamContent }]),
        edit.externalConversationId,
        context,
        target
      )
    ).rejects.toMatchObject({ code: 'DIFY_HISTORY_RECONCILIATION_REQUIRED' });
    await expect(
      sanitizeDifyMessageHistory(
        { text: edit.upstreamContent },
        edit.externalConversationId,
        context,
        target
      )
    ).rejects.toMatchObject({ code: 'DIFY_HISTORY_UNAVAILABLE' });
  });
});
