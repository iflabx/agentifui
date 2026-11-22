/** @jest-environment node */
import { buildMessageEditPrompt } from '@agentifui/shared';

import {
  activateMessageEdit,
  buildEditPrompt,
  resolveMessageEdit,
  stripMessageEditMetadata,
} from './message-edits';
import { runWithPgSystemContext } from './pg-context';

jest.mock('./pg-context', () => ({ runWithPgSystemContext: jest.fn() }));

const conversationId = '10000000-0000-4000-8000-000000000001';
const sourceId = '20000000-0000-4000-8000-000000000001';
const messageId = '30000000-0000-4000-8000-000000000001';
const userId = '40000000-0000-4000-8000-000000000001';

function database() {
  const query = jest.fn().mockResolvedValue({ rows: [], rowCount: 1 });
  return { query };
}

describe('trusted message edits', () => {
  beforeEach(() => jest.resetAllMocks());

  it('delegates the prompt and original user-turn locator to the shared contract', () => {
    expect(buildEditPrompt('continue', 'new request', 7)).toBe(
      buildMessageEditPrompt('continue', 'new request', 7)
    );
  });

  it('counts the full original user path, while checking the source is owned and visible', async () => {
    const client = database();
    client.query.mockResolvedValue({
      rows: [{ content: 'continue', user_turn: 7 }],
    });
    const result = await resolveMessageEdit(
      { userId, conversationId, sourceId, content: 'replacement' },
      client
    );
    expect(result.upstreamContent).toBe(
      buildMessageEditPrompt('continue', 'replacement', 7)
    );
    const [sql, params] = client.query.mock.calls[0];
    expect(params).toEqual([sourceId, conversationId, userId]);
    for (const predicate of [
      "preceding.role = 'user'",
      'COUNT(*)::int',
      'conversation.user_id = $3::uuid',
      'message.user_id = $3::uuid',
      "message.role = 'user'",
      "conversation.status = 'active'",
      'edit_hidden',
      'edit_pending',
    ])
      expect(sql).toContain(predicate);
    expect(
      sql.slice(sql.indexOf('SELECT COUNT'), sql.indexOf('AS user_turn'))
    ).not.toContain('edit_hidden');
  });

  it('opens a transaction when the caller does not supply one', async () => {
    const client = database();
    client.query.mockResolvedValue({
      rows: [{ content: 'old', user_turn: 1 }],
    });
    jest
      .mocked(runWithPgSystemContext)
      .mockImplementation(async operation => operation(client as never));
    await resolveMessageEdit({
      userId,
      conversationId,
      sourceId,
      content: 'new',
    });
    expect(runWithPgSystemContext).toHaveBeenCalledTimes(1);
  });

  it.each(['not-a-local-uuid', 'msg-1700000000000-abc'])(
    'rejects nonlocal source %s without querying',
    async invalid => {
      const client = database();
      await expect(
        resolveMessageEdit(
          { userId, conversationId, sourceId: invalid, content: 'new' },
          client
        )
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(client.query).not.toHaveBeenCalled();
    }
  );

  it('rejects unavailable, hidden, pending or foreign sources selected out by SQL', async () => {
    const client = database();
    await expect(
      resolveMessageEdit(
        { userId, conversationId, sourceId, content: 'new' },
        client
      )
    ).rejects.toMatchObject({ code: 'MESSAGE_EDIT_SOURCE_UNAVAILABLE' });
  });

  it.each(['x'.repeat(16000), '\u0001'.repeat(10900)])(
    'bounds the actual serialized upstream prompt',
    async content => {
      const client = database();
      client.query.mockResolvedValue({
        rows: [{ content: 'old', user_turn: 1 }],
      });
      await expect(
        resolveMessageEdit(
          { userId, conversationId, sourceId, content },
          client
        )
      ).rejects.toMatchObject({
        statusCode: 413,
        code: 'AGENT_MESSAGE_TOO_LONG',
      });
    }
  );

  it('strips all client edit state while preserving attachment metadata', () => {
    expect(
      stripMessageEditMetadata({
        edit_hidden: false,
        edit_source_id: sourceId,
        edit_pending: false,
        edit_upstream_hash: 'forged',
        client_message_id: 'msg-timestamp-Random',
        attachments: [{ id: 'file' }],
      })
    ).toEqual({
      client_message_id: 'msg-timestamp-Random',
      attachments: [{ id: 'file' }],
    });
  });

  it('atomically hides the superseded interval, activates the replacement and updates the preview', async () => {
    const client = database();
    client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        { id: sourceId, role: 'user', user_id: userId, metadata: {} },
        {
          id: messageId,
          role: 'user',
          user_id: userId,
          metadata: { edit_pending: true },
        },
      ],
    });
    await activateMessageEdit(client, conversationId, sourceId, messageId);
    expect(client.query.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(client.query.mock.calls[2][0]).toContain('"edit_hidden":true');
    expect(client.query.mock.calls[2][1]).toEqual([
      conversationId,
      sourceId,
      messageId,
    ]);
    expect(client.query.mock.calls[3][0]).toContain(
      "- 'edit_pending_source_id' - 'edit_pending'"
    );
    expect(client.query.mock.calls[4][0]).toContain(
      'last_message_preview = LEFT(message.content, 200), updated_at = NOW()'
    );
  });

  it('does not overwrite a newer answer preview when acceptance is replayed', async () => {
    const client = database();
    client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        {
          id: sourceId,
          role: 'user',
          user_id: userId,
          metadata: { edit_hidden: true },
        },
        {
          id: messageId,
          role: 'user',
          user_id: userId,
          metadata: { edit_source_id: sourceId },
        },
      ],
    });
    await activateMessageEdit(client, conversationId, sourceId, messageId);
    expect(client.query).toHaveBeenCalledTimes(2);
  });

  it.each([
    { role: 'assistant', user_id: userId, metadata: {} },
    { role: 'user', user_id: 'foreign', metadata: {} },
    { role: 'user', user_id: userId, metadata: { edit_hidden: true } },
    { role: 'user', user_id: userId, metadata: { edit_pending: true } },
  ])('rejects invalid activation without hiding anything: %j', async source => {
    const client = database();
    client.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        { id: sourceId, ...source },
        { id: messageId, role: 'user', user_id: userId, metadata: {} },
      ],
    });
    await expect(
      activateMessageEdit(client, conversationId, sourceId, messageId)
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(client.query).toHaveBeenCalledTimes(2);
  });
});
