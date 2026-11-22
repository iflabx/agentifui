import { AgentPolicyError } from '../../lib/agent-backends';
import {
  type ResolvedMessageEdit,
  activateMessageEdit,
  lockMessageEditConversation,
  messageEditHash,
  resolveMessageEdit,
} from '../../lib/message-edits';
import { runWithPgSystemContext } from '../../lib/pg-context';
import { isObjectRecord } from './helpers';
import type { DifyProxyRequestContext, DifyProxyTargetConfig } from './types';

export interface DifyMessageEdit extends ResolvedMessageEdit {
  clientMessageId: string;
  externalConversationId: string;
  messageId?: string;
}

async function findOwnedConversation(
  client: Parameters<typeof activateMessageEdit>[0],
  context: DifyProxyRequestContext,
  target: DifyProxyTargetConfig,
  externalId: string
) {
  const { rows } = await client.query<{ id: string; has_edits: boolean }>(
    `SELECT conversation.id::text, EXISTS (
       SELECT 1 FROM messages message WHERE message.conversation_id = conversation.id
         AND (message.metadata ? 'edit_upstream_hash' OR message.metadata ->> 'edit_hidden' = 'true')
     ) AS has_edits FROM conversations conversation
     JOIN service_instances instance ON instance.id = $3::uuid
       AND (conversation.app_id = instance.instance_id OR conversation.app_id = instance.id::text)
     WHERE conversation.external_id = $1 AND conversation.user_id = $2::uuid
       AND NOT EXISTS (SELECT 1 FROM backend_conversations binding
         WHERE binding.conversation_id = conversation.id)`,
    [externalId, context.actor.userId, target.serviceInstanceId]
  );
  return rows[0];
}

export async function resolveDifyMessageEdit(
  context: DifyProxyRequestContext,
  target: DifyProxyTargetConfig,
  method: string,
  path: string
): Promise<DifyMessageEdit | undefined> {
  const body = target.rawBody;
  if (
    !isObjectRecord(body) ||
    (!('editSourceId' in body) && !('editMessageId' in body))
  )
    return undefined;
  if (
    method !== 'POST' ||
    path !== 'chat-messages' ||
    target.tempConfigUsed ||
    !['chatbot', 'agent', 'chatflow'].includes(
      target.appType?.toLowerCase() ?? ''
    ) ||
    typeof body.editSourceId !== 'string' ||
    typeof body.editMessageId !== 'string' ||
    !body.editMessageId.trim() ||
    body.editMessageId.length > 255 ||
    typeof body.conversation_id !== 'string' ||
    !body.conversation_id ||
    typeof body.query !== 'string' ||
    !body.query.trim()
  )
    throw new AgentPolicyError(400, 'INVALID_MESSAGE_EDIT');
  const sourceId = body.editSourceId.toLowerCase();
  const clientMessageId = body.editMessageId;
  const externalConversationId = body.conversation_id;
  const content = body.query.trim();
  return runWithPgSystemContext(async client => {
    const conversation = await findOwnedConversation(
      client,
      context,
      target,
      externalConversationId
    );
    if (!conversation)
      throw new AgentPolicyError(404, 'MESSAGE_EDIT_CONVERSATION_UNAVAILABLE');
    const conversationId = conversation.id;
    const edit = await resolveMessageEdit(
      {
        userId: context.actor.userId,
        conversationId,
        sourceId,
        content,
      },
      client
    );
    return { ...edit, clientMessageId, externalConversationId };
  });
}

export async function stageDifyMessageEdit(
  edit: DifyMessageEdit,
  rootTaskId: string
) {
  return runWithPgSystemContext(async client => {
    await lockMessageEditConversation(client, edit.conversationId);
    await resolveMessageEdit(edit, client);
    const { rows } = await client.query<{
      id: string;
      content: string;
      metadata: Record<string, unknown>;
    }>(
      `SELECT id::text, content, metadata FROM messages
       WHERE conversation_id = $1::uuid AND role = 'user' AND user_id = $2::uuid
         AND metadata ->> 'client_message_id' = $3 ORDER BY created_at, id LIMIT 1`,
      [edit.conversationId, edit.userId, edit.clientMessageId]
    );
    const existing = rows[0];
    if (
      existing &&
      (existing.id === edit.sourceId ||
        existing.content !== edit.content ||
        existing.metadata?.edit_source_id ||
        existing.metadata?.edit_hidden ||
        (existing.metadata?.edit_root_task_id &&
          existing.metadata.edit_root_task_id !== rootTaskId))
    )
      throw new AgentPolicyError(409, 'MESSAGE_EDIT_IDENTITY_CONFLICT');
    const metadata = {
      client_message_id: edit.clientMessageId,
      edit_pending: true,
      edit_pending_source_id: edit.sourceId,
      edit_root_task_id: rootTaskId,
      edit_upstream_hash: messageEditHash(edit.upstreamContent),
    };
    if (existing) {
      await client.query(
        `UPDATE messages SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1::uuid`,
        [existing.id, JSON.stringify(metadata)]
      );
      return { ...edit, messageId: existing.id };
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO messages (conversation_id, user_id, role, content, metadata, status, is_synced, sequence_index)
       VALUES ($1::uuid, $2::uuid, 'user', $3, $4::jsonb, 'sent', TRUE, 0) RETURNING id::text`,
      [edit.conversationId, edit.userId, edit.content, JSON.stringify(metadata)]
    );
    return { ...edit, messageId: inserted.rows[0].id };
  });
}

export async function acceptDifyMessageEdit(
  edit: DifyMessageEdit,
  event: Record<string, unknown>
) {
  const data = isObjectRecord(event.data) ? event.data : {};
  const identities = [
    event.message_id,
    event.task_id,
    event.workflow_run_id,
    ['workflow_started', 'workflow_finished'].includes(String(event.event))
      ? data.id
      : undefined,
  ];
  if (!edit.messageId || !identities.some(id => typeof id === 'string' && !!id))
    return;
  if (
    event.conversation_id !== undefined &&
    event.conversation_id !== edit.externalConversationId
  )
    throw new AgentPolicyError(503, 'MESSAGE_EDIT_BINDING_MISMATCH');
  await runWithPgSystemContext(async client => {
    await activateMessageEdit(
      client,
      edit.conversationId,
      edit.sourceId,
      edit.messageId!
    );
    if (typeof event.message_id === 'string' && event.message_id)
      await client.query(
        'UPDATE messages SET external_id = $2 WHERE id = $1::uuid',
        [edit.messageId, event.message_id]
      );
  });
}

interface HistoryMessage {
  id: string;
  role: string;
  content: string;
  external_id: string | null;
  metadata: Record<string, unknown>;
}

function matchHistoryMessage(
  rows: HistoryMessage[],
  entry: Record<string, unknown>
) {
  const exact = rows.find(
    row => row.external_id && row.external_id === entry.id
  );
  if (exact) {
    if (exact.role === 'user' || exact.metadata?.edit_hidden === true)
      return exact;
    const precedingUser = rows
      .slice(0, rows.indexOf(exact))
      .reverse()
      .find(row => row.role === 'user');
    if (precedingUser) return precedingUser;
  }
  const hash =
    typeof entry.query === 'string' ? messageEditHash(entry.query) : null;
  const edits = rows.filter(
    row =>
      row.role === 'user' && hash && row.metadata?.edit_upstream_hash === hash
  );
  if (edits.length > 1)
    throw new AgentPolicyError(503, 'DIFY_HISTORY_RECONCILIATION_REQUIRED');
  if (edits[0]) return edits[0];
  const plain = rows.filter(
    row =>
      row.role === 'user' &&
      row.content === entry.query &&
      !row.metadata?.edit_upstream_hash
  );
  if (
    plain.length > 1 &&
    plain.some(row => row.metadata?.edit_hidden === true) &&
    plain.some(row => row.metadata?.edit_hidden !== true)
  )
    throw new AgentPolicyError(503, 'DIFY_HISTORY_RECONCILIATION_REQUIRED');
  return plain[0];
}

async function sanitizeHistoryPage(
  value: unknown,
  externalId: string,
  context: DifyProxyRequestContext,
  target: DifyProxyTargetConfig
) {
  if (!isObjectRecord(value) || !Array.isArray(value.data))
    throw new AgentPolicyError(503, 'DIFY_HISTORY_UNAVAILABLE');
  const entries = value.data;
  if (
    entries.some(
      entry =>
        !isObjectRecord(entry) || typeof entry.id !== 'string' || !entry.id
    )
  )
    throw new AgentPolicyError(503, 'DIFY_HISTORY_UNAVAILABLE');
  return runWithPgSystemContext(async client => {
    const conversation = await findOwnedConversation(
      client,
      context,
      target,
      externalId
    );
    if (!conversation?.has_edits)
      return { ...value, data: entries, has_more: value.has_more === true };
    const conversationId = conversation.id;
    await lockMessageEditConversation(client, conversationId);
    const loadMessages = async () =>
      (
        await client.query<HistoryMessage>(
          `SELECT id::text, role::text, content, external_id, metadata FROM messages
         WHERE conversation_id = $1::uuid
         ORDER BY created_at, COALESCE(sequence_index, 0), id`,
          [conversationId]
        )
      ).rows;
    let rows = await loadMessages();
    for (const entry of entries) {
      const hash =
        typeof entry.query === 'string' ? messageEditHash(entry.query) : null;
      const pending = rows.filter(
        row =>
          row.metadata?.edit_pending === true &&
          (row.external_id === entry.id ||
            (hash && row.metadata?.edit_upstream_hash === hash))
      );
      if (pending.length > 1)
        throw new AgentPolicyError(503, 'DIFY_HISTORY_RECONCILIATION_REQUIRED');
      const local = pending[0];
      if (local) {
        await acceptDifyHistoryEdit(client, conversationId, local, entry);
        rows = await loadMessages();
      }
    }
    const hasEdits = rows.some(
      row =>
        row.metadata?.edit_pending === true ||
        row.metadata?.edit_hidden === true ||
        row.metadata?.edit_source_id
    );
    const data: Record<string, unknown>[] = [];
    for (const entry of entries) {
      const local = matchHistoryMessage(rows, entry);
      if (!local) {
        if (hasEdits)
          throw new AgentPolicyError(
            503,
            'DIFY_HISTORY_RECONCILIATION_REQUIRED'
          );
        data.push(entry);
        continue;
      }
      if (
        local.metadata?.edit_hidden === true ||
        local.metadata?.edit_pending === true
      )
        continue;
      const inputs = isObjectRecord(entry.inputs)
        ? { ...entry.inputs }
        : entry.inputs;
      if (isObjectRecord(inputs) && inputs.query === entry.query)
        inputs.query = local.content;
      data.push({ ...entry, query: local.content, inputs });
    }
    return { ...value, data, has_more: value.has_more === true };
  });
}

export async function sanitizeDifyMessageHistory(
  value: unknown,
  externalId: string,
  context: DifyProxyRequestContext,
  target: DifyProxyTargetConfig,
  loadPage?: (firstId: string) => Promise<unknown>,
  firstId?: string
): Promise<unknown> {
  const cursors = new Set(firstId ? [firstId] : []);
  for (let page = 0; page < 100; page += 1) {
    const visible = await sanitizeHistoryPage(
      value,
      externalId,
      context,
      target
    );
    if (visible.data.length || !visible.has_more) return visible;
    const entries = (value as { data: Record<string, unknown>[] }).data;
    const cursor = entries.at(-1)?.id;
    if (!loadPage || typeof cursor !== 'string' || cursors.has(cursor))
      throw new AgentPolicyError(503, 'DIFY_HISTORY_PAGINATION_UNAVAILABLE');
    cursors.add(cursor);
    value = await loadPage(cursor);
  }
  throw new AgentPolicyError(503, 'DIFY_HISTORY_PAGINATION_LIMIT');
}

async function acceptDifyHistoryEdit(
  client: Parameters<typeof activateMessageEdit>[0],
  conversationId: string,
  local: { id: string; metadata: Record<string, unknown> },
  entry: Record<string, unknown>
) {
  if (
    typeof local.metadata.edit_pending_source_id !== 'string' ||
    typeof entry.id !== 'string'
  )
    throw new AgentPolicyError(503, 'DIFY_HISTORY_UNAVAILABLE');
  await activateMessageEdit(
    client,
    conversationId,
    local.metadata.edit_pending_source_id,
    local.id
  );
  await client.query(
    'UPDATE messages SET external_id = $2 WHERE id = $1::uuid',
    [local.id, entry.id]
  );
}
