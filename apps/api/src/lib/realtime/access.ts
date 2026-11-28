import {
  boundConversationAccessSql,
  unboundConversationSql,
} from '../../routes/internal-data-route/auth';
import { queryRowsWithPgSystemContext } from '../pg-context';
import type { ActorIdentity } from '../session-identity';
import type { RealtimeEnvelope, RealtimeRow } from './contract';

const SAFE_FIELDS: Record<string, string[]> = {
  conversations: [
    'id',
    'user_id',
    'title',
    'summary',
    'status',
    'external_id',
    'app_id',
    'last_message_preview',
    'created_at',
    'updated_at',
  ],
  messages: [
    'id',
    'conversation_id',
    'user_id',
    'role',
    'content',
    'metadata',
    'created_at',
    'status',
    'external_id',
    'token_count',
    'is_synced',
    'sequence_index',
  ],
  profiles: [
    'id',
    'username',
    'full_name',
    'avatar_url',
    'role',
    'status',
    'updated_at',
  ],
  providers: [
    'id',
    'name',
    'type',
    'is_active',
    'is_default',
    'created_at',
    'updated_at',
  ],
  service_instances: [
    'id',
    'provider_id',
    'display_name',
    'description',
    'visibility',
    'is_default',
    'updated_at',
  ],
  api_keys: [
    'id',
    'provider_id',
    'service_instance_id',
    'is_default',
    'credential_version',
    'updated_at',
  ],
};
function pick(row: RealtimeRow | null, fields: string[]): RealtimeRow | null {
  if (!row) return null;
  return Object.fromEntries(
    fields.filter(key => Object.hasOwn(row, key)).map(key => [key, row[key]])
  );
}

export function realtimeConversationAccessSql(): string {
  return `${boundConversationAccessSql('$2')} AND
    (NOT (${unboundConversationSql}) OR conversations.app_id IS NOT NULL)`;
}

export async function projectAuthorizedRealtimeEvent(
  event: RealtimeEnvelope,
  actor: ActorIdentity
): Promise<RealtimeEnvelope | null> {
  const payload = event.payload;
  const fields = SAFE_FIELDS[payload.table];
  if (!fields) return null;
  const row = payload.new || payload.old;
  if (!row) return null;
  const deleted = payload.eventType === 'DELETE';
  if (payload.table === 'conversations' || payload.table === 'messages') {
    if (deleted && payload.table === 'conversations') {
      if (row.user_id !== actor.userId && actor.role !== 'admin') return null;
    } else {
      const conversationId =
        payload.table === 'messages' ? row.conversation_id : row.id;
      if (
        typeof conversationId !== 'string' ||
        !/^[0-9a-f-]{36}$/i.test(conversationId)
      )
        return null;
      const rows = await queryRowsWithPgSystemContext(
        `SELECT conversations.id FROM conversations
        WHERE conversations.id=$1::uuid AND conversations.user_id=$2::uuid
          AND conversations.status='active' AND ${realtimeConversationAccessSql()} LIMIT 1`,
        [conversationId, actor.userId],
        { statementTimeoutMs: 5000 }
      );
      if (!rows.length) {
        if (payload.table !== 'conversations' || row.user_id !== actor.userId)
          return null;
        return {
          ...event,
          payload: {
            ...payload,
            new: pick(payload.new, ['id', 'user_id', 'status']),
            old: pick(payload.old, ['id', 'user_id']),
          },
        };
      }
    }
  }
  return {
    ...event,
    payload: {
      ...payload,
      new: pick(
        payload.new,
        deleted ? ['id', 'user_id', 'conversation_id'] : fields
      ),
      old: pick(payload.old, ['id', 'user_id', 'conversation_id']),
    },
  };
}
