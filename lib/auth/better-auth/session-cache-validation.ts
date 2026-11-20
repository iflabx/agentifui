import { getPgPool } from '@lib/server/pg/pool';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export async function isSessionCacheLive(
  lookupToken: string,
  value: string
): Promise<boolean> {
  let payload: unknown;
  try {
    payload = JSON.parse(value);
  } catch {
    return false;
  }

  if (!isRecord(payload)) {
    return false;
  }

  const { session, user } = payload;
  if (
    !isRecord(session) ||
    !isRecord(user) ||
    !isNonEmptyString(session.id) ||
    !isNonEmptyString(session.userId) ||
    session.token !== lookupToken ||
    user.id !== session.userId ||
    typeof session.expiresAt !== 'string'
  ) {
    return false;
  }

  const cachedExpiresAt = Date.parse(session.expiresAt);
  if (!Number.isFinite(cachedExpiresAt) || cachedExpiresAt <= Date.now()) {
    return false;
  }

  const { rows } = await getPgPool().query<{
    expires_at: Date | string;
  }>(
    `
      SELECT expires_at
      FROM auth_sessions
      WHERE token = $1::text
        AND id::text = $2::text
        AND user_id::text = $3::text
        AND expires_at > CURRENT_TIMESTAMP
      LIMIT 1
    `,
    [lookupToken, session.id, session.userId]
  );

  const row = rows[0];
  if (!row) {
    return false;
  }

  const databaseExpiresAt =
    row.expires_at instanceof Date
      ? row.expires_at.getTime()
      : Date.parse(row.expires_at);
  const now = Date.now();
  return (
    Number.isFinite(databaseExpiresAt) &&
    databaseExpiresAt > now &&
    cachedExpiresAt > now
  );
}
