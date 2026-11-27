import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import { boundConversationAccessSql } from './auth';
import { readString, toErrorResponse, toSuccessResponse } from './helpers';

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
const pageSize = 20;
const queryOptions = { statementTimeoutMs: 5000 };

function visibleMessageSql() {
  return `
    conversations.user_id = $1::uuid
    AND conversations.status = 'active'
    AND EXISTS (SELECT 1 FROM profiles WHERE id = $1::uuid AND status = 'active')
    AND ${boundConversationAccessSql('$1', true)}
    AND messages.role IN ('user', 'assistant')
    AND COALESCE(messages.metadata ->> 'edit_hidden', 'false') <> 'true'
    AND COALESCE(messages.metadata ->> 'edit_pending', 'false') <> 'true'
  `;
}

interface HistoryRow {
  id: string;
  conversationId: string;
  title: string | null;
  role: 'user' | 'assistant';
}

const historyColumns = `messages.id::text AS id,
  conversations.id::text AS "conversationId",
  conversations.title,
  messages.role::text AS role`;

export async function searchHistory(
  actor: string,
  payload?: Record<string, unknown>
) {
  const query = readString(payload?.query);
  const before = readString(payload?.beforeMessageId);
  if (
    !query ||
    [...query].length > 120 ||
    query.includes('\x00') ||
    (payload?.beforeMessageId !== undefined && !uuid.test(before))
  ) {
    return toErrorResponse('Invalid history search', 400);
  }

  const rows = await queryRowsWithPgSystemContext<
    HistoryRow & { snippet: string }
  >(
    `
    WITH hits AS (
      SELECT ${historyColumns}, messages.content, messages.created_at,
        strpos(lower(messages.content), lower($2::text)) AS position
      FROM conversations
      JOIN messages ON messages.conversation_id = conversations.id
      WHERE ${visibleMessageSql()}
        AND ($3::uuid IS NULL OR (messages.created_at, messages.id) < (
          SELECT anchor.created_at, anchor.id FROM messages anchor
          JOIN conversations owner ON owner.id = anchor.conversation_id
          WHERE anchor.id = $3::uuid AND owner.user_id = $1::uuid
        ))
        AND strpos(lower(messages.content), lower($2::text)) > 0
      ORDER BY messages.created_at DESC, messages.id DESC
      LIMIT $4
    )
    SELECT id, "conversationId", title, role,
      CASE WHEN position > 61 THEN '...' ELSE '' END ||
      substr(content, greatest(1, position - 60), 240) ||
      CASE WHEN length(content) >= greatest(1, position - 60) + 240
        THEN '...' ELSE '' END AS snippet
    FROM hits
    ORDER BY created_at DESC, id::uuid DESC
    `,
    [actor, query, before || null, pageSize + 1],
    queryOptions
  );
  const hits = rows.slice(0, pageSize);
  return toSuccessResponse({
    hits,
    nextCursor: rows.length > pageSize ? (hits.at(-1)?.id ?? null) : null,
  });
}

export async function getHistoryMatch(
  actor: string,
  payload?: Record<string, unknown>
) {
  const conversationId = readString(payload?.conversationId);
  const messageId = readString(payload?.messageId);
  if (!uuid.test(conversationId) || !uuid.test(messageId))
    return toErrorResponse('Invalid history message', 400);

  const rows = await queryRowsWithPgSystemContext<
    HistoryRow & {
      content: string;
      externalId: string | null;
      appId: string | null;
      agent: boolean;
    }
  >(
    `
    SELECT ${historyColumns}, messages.content,
      conversations.external_id AS "externalId", conversations.app_id AS "appId",
      EXISTS (SELECT 1 FROM backend_conversations binding
        WHERE binding.conversation_id = conversations.id) AS agent
    FROM conversations
    JOIN messages ON messages.conversation_id = conversations.id
    WHERE conversations.id = $2::uuid AND messages.id = $3::uuid
      AND ${visibleMessageSql()}
    LIMIT 1
    `,
    [actor, conversationId, messageId],
    queryOptions
  );
  return rows[0]
    ? toSuccessResponse(rows[0])
    : toErrorResponse('History message not found', 404);
}
