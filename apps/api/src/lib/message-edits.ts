import { buildMessageEditPrompt } from '@agentifui/shared';
import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

import { AgentPolicyError } from './agent-backends';
import { runWithPgSystemContext } from './pg-context';

type EditClient = Pick<PoolClient, 'query'>;

export interface MessageEditInput {
  userId: string;
  conversationId: string;
  sourceId: string;
  content: string;
}

export interface ResolvedMessageEdit extends MessageEditInput {
  upstreamContent: string;
}

export function buildEditPrompt(
  original: string,
  content: string,
  userTurn?: number
): string {
  return buildMessageEditPrompt(original, content, userTurn);
}

export function stripMessageEditMetadata(
  metadata: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(metadata).filter(([key]) => !key.startsWith('edit_'))
  );
}

export function messageEditHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

export async function lockMessageEditConversation(
  client: EditClient,
  conversationId: string
) {
  await client.query(
    'SELECT id FROM conversations WHERE id = $1::uuid FOR UPDATE',
    [conversationId]
  );
}

export async function resolveMessageEdit(
  input: MessageEditInput,
  client?: EditClient
): Promise<ResolvedMessageEdit> {
  if (
    !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(input.sourceId) ||
    typeof input.content !== 'string' ||
    !input.content.trim()
  )
    throw new AgentPolicyError(400, 'INVALID_MESSAGE_EDIT');
  if (!client)
    return runWithPgSystemContext(transaction =>
      resolveMessageEdit(input, transaction)
    );
  const { rows } = await client.query<{ content: string; user_turn: number }>(
    `SELECT message.content, (
       SELECT COUNT(*)::int FROM messages preceding
       WHERE preceding.conversation_id = message.conversation_id AND preceding.role = 'user'
         AND (preceding.created_at, COALESCE(preceding.sequence_index, 0), preceding.id)
           <= (message.created_at, COALESCE(message.sequence_index, 0), message.id)
     ) AS user_turn FROM messages message
     JOIN conversations conversation ON conversation.id = message.conversation_id
     WHERE message.id = $1::uuid AND message.conversation_id = $2::uuid
       AND conversation.user_id = $3::uuid AND conversation.status = 'active'
       AND message.role = 'user' AND message.user_id = $3::uuid
       AND COALESCE(message.metadata ->> 'edit_hidden', 'false') <> 'true'
       AND COALESCE(message.metadata ->> 'edit_pending', 'false') <> 'true'`,
    [input.sourceId, input.conversationId, input.userId]
  );
  if (!rows[0]?.content.trim())
    throw new AgentPolicyError(404, 'MESSAGE_EDIT_SOURCE_UNAVAILABLE');
  const upstreamContent = buildEditPrompt(
    rows[0].content,
    input.content,
    rows[0].user_turn
  );
  if (
    upstreamContent.length > 16000 ||
    Buffer.byteLength(JSON.stringify(upstreamContent), 'utf8') > 63000
  )
    throw new AgentPolicyError(413, 'AGENT_MESSAGE_TOO_LONG');
  return { ...input, upstreamContent };
}

export async function activateMessageEdit(
  client: EditClient,
  conversationId: string,
  sourceId: string,
  messageId: string
): Promise<void> {
  sourceId = sourceId.toLowerCase();
  messageId = messageId.toLowerCase();
  await lockMessageEditConversation(client, conversationId);
  const { rows } = await client.query<{
    id: string;
    role: string;
    user_id: string;
    metadata: Record<string, unknown>;
  }>(
    `SELECT id::text, role::text, user_id::text, metadata FROM messages
     WHERE conversation_id = $1::uuid AND id = ANY($2::uuid[])`,
    [conversationId, [sourceId, messageId]]
  );
  const source = rows.find(row => row.id === sourceId);
  const replacement = rows.find(row => row.id === messageId);
  if (
    sourceId === messageId ||
    !source ||
    !replacement ||
    source.role !== 'user' ||
    replacement.role !== 'user' ||
    !source.user_id ||
    source.user_id !== replacement.user_id
  )
    throw new AgentPolicyError(409, 'MESSAGE_EDIT_SOURCE_UNAVAILABLE');
  if (replacement.metadata?.edit_source_id === sourceId) return;
  if (
    source.metadata?.edit_hidden === true ||
    source.metadata?.edit_pending === true
  )
    throw new AgentPolicyError(409, 'MESSAGE_EDIT_SOURCE_UNAVAILABLE');
  const hidden = await client.query(
    `UPDATE messages SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"edit_hidden":true}'::jsonb
     WHERE conversation_id = $1::uuid
       AND (created_at, COALESCE(sequence_index, 0), id) >= (
         SELECT created_at, COALESCE(sequence_index, 0), id FROM messages WHERE id = $2::uuid
       )
       AND (created_at, COALESCE(sequence_index, 0), id) < (
         SELECT created_at, COALESCE(sequence_index, 0), id FROM messages WHERE id = $3::uuid
       )`,
    [conversationId, sourceId, messageId]
  );
  if (!hidden.rowCount)
    throw new AgentPolicyError(409, 'MESSAGE_EDIT_ORDER_INVALID');
  await client.query(
    `UPDATE messages SET metadata = (COALESCE(metadata, '{}'::jsonb)
       - 'edit_pending_source_id' - 'edit_pending') || jsonb_build_object('edit_source_id', $3::text)
     WHERE conversation_id = $1::uuid AND id = $2::uuid`,
    [conversationId, messageId, sourceId]
  );
  await client.query(
    `UPDATE conversations SET last_message_preview = LEFT(message.content, 200), updated_at = NOW()
     FROM messages message WHERE conversations.id = $1::uuid AND message.id = $2::uuid`,
    [conversationId, messageId]
  );
}
