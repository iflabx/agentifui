import type { PoolClient } from 'pg';
import { createClient } from 'redis';

import { invalidateSessionIdentityTokens } from './session-identity';
import { INTERNAL_AUTH_ISSUER } from './session-identity/helpers';

export interface RevokedLoginSession {
  token: string;
  user_id: string;
}

export async function deleteUserLoginSessions(
  client: PoolClient,
  userId: string
): Promise<RevokedLoginSession[]> {
  const target = await client.query(
    'SELECT id FROM profiles WHERE id=$1::uuid',
    [userId]
  );
  if (!target.rows.length) throw new Error('ADMIN_TARGET_NOT_FOUND');
  return (
    await client.query<RevokedLoginSession>(
      `DELETE FROM auth_sessions s
    WHERE s.user_id IN (
      SELECT au.id FROM auth_users au JOIN user_identities ui ON ui.subject=au.id::text
        WHERE ui.issuer=$2 AND ui.user_id=$1::uuid
      UNION SELECT au.id FROM auth_users au WHERE au.id=$1::uuid AND NOT EXISTS (
        SELECT 1 FROM user_identities ui WHERE ui.issuer=$2 AND ui.subject=au.id::text AND ui.user_id<>$1::uuid))
    RETURNING s.token,s.user_id::text`,
      [userId, INTERNAL_AUTH_ISSUER]
    )
  ).rows;
}

export async function cleanupRevokedLoginSessions(
  sessions: RevokedLoginSession[]
): Promise<'completed' | 'pending'> {
  if (!sessions.length) return 'completed';
  invalidateSessionIdentityTokens(sessions.map(session => session.token));
  const host = process.env.REDIS_HOST || '127.0.0.1';
  const password = process.env.REDIS_PASSWORD;
  const url =
    process.env.REDIS_URL ||
    `redis://${password ? `:${encodeURIComponent(password)}@` : ''}${host}:${process.env.REDIS_PORT || '6379'}/${process.env.REDIS_DB || '0'}`;
  const client = createClient({
    url,
    socket: { connectTimeout: 2000, reconnectStrategy: false },
  });
  client.on('error', () => {});
  const prefix = `${(process.env.REDIS_PREFIX?.trim() || 'agentifui').replace(/:+$/, '')}:better-auth:secondary:`;
  try {
    await client.connect();
    for (const session of sessions) {
      const cleaned = await client.eval(
        `
        redis.call('DEL', KEYS[1])
        local raw = redis.call('GET', KEYS[2])
        if not raw then return 1 end
        local ok, entries = pcall(cjson.decode, raw)
        if not ok or type(entries) ~= 'table' then return 0 end
        local kept = {}
        for _, entry in ipairs(entries) do
          if entry.token ~= ARGV[1] then table.insert(kept, entry) end
        end
        if #kept == 0 then redis.call('DEL', KEYS[2])
        else redis.call('SET', KEYS[2], cjson.encode(kept), 'KEEPTTL') end
        return 1`,
        {
          keys: [
            prefix + session.token,
            prefix + 'active-sessions-' + session.user_id,
          ],
          arguments: [session.token],
        }
      );
      if (Number(cleaned) !== 1) return 'pending';
    }
    return 'completed';
  } catch {
    return 'pending';
  } finally {
    if (client.isOpen) client.destroy();
  }
}
