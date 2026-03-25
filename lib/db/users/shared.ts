const IS_BROWSER = typeof window !== 'undefined';

type RealtimeRow = Record<string, unknown>;

export { IS_BROWSER };
export type { RealtimeRow };

export async function publishProfileChangeBestEffort(input: {
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: RealtimeRow | null;
  oldRow: RealtimeRow | null;
}) {
  if (IS_BROWSER) {
    return;
  }

  try {
    const runtimeRequire = eval('require') as (id: string) => unknown;
    const publisherModule = runtimeRequire('../server/realtime/publisher') as {
      publishTableChangeEvent?: (payload: {
        table: string;
        eventType: 'INSERT' | 'UPDATE' | 'DELETE';
        newRow: RealtimeRow | null;
        oldRow: RealtimeRow | null;
      }) => Promise<void>;
    };
    const publisher = publisherModule.publishTableChangeEvent;
    if (typeof publisher !== 'function') {
      return;
    }

    await publisher({
      table: 'profiles',
      eventType: input.eventType,
      oldRow: input.oldRow,
      newRow: input.newRow,
    });
  } catch (error) {
    console.warn('[UsersDB] Realtime publish failed:', error);
  }
}

export async function getPool() {
  const { getPgPool } = await import('@lib/server/pg/pool');
  return getPgPool();
}

export async function queryRowsWithActorContext<T extends object>(
  actorUserId: string | undefined,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  if (!actorUserId) {
    const pool = await getPool();
    const { rows } = await pool.query<T>(sql, params);
    return rows;
  }

  const { queryRowsWithPgUserContext } = await import(
    '@lib/server/pg/user-context'
  );
  return queryRowsWithPgUserContext<T>(actorUserId, sql, params);
}
