import { DatabaseError } from '@lib/types/result';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  boolean,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export type ManagedOrderByOption = {
  column: string;
  ascending?: boolean;
};

export type ManagedPaginationOption = {
  offset: number;
  limit: number;
};

type Row = Record<string, unknown>;
type FilterMap = Record<string, unknown>;
type ColumnLike = Parameters<typeof isNull>[0];
type ConditionLike = ReturnType<typeof eq> | ReturnType<typeof isNull>;
type QueryBuilder = PromiseLike<unknown[]> & {
  where: (condition: unknown) => QueryBuilder;
  orderBy: (order: unknown) => QueryBuilder;
  offset: (offset: number) => QueryBuilder;
  limit: (limit: number) => QueryBuilder;
};
type DrizzleDb = {
  select: (...args: unknown[]) => {
    from: (table: object) => QueryBuilder;
  };
  insert: (table: object) => {
    values: (payload: Row) => {
      returning: () => Promise<unknown[]>;
    };
  };
  update: (table: object) => {
    set: (payload: Row) => {
      where: (condition: unknown) => {
        returning: () => Promise<unknown[]>;
      };
    };
  };
  delete: (table: object) => {
    where: (condition: unknown) => Promise<unknown>;
  };
};

const userRoleEnum = pgEnum('user_role', ['admin', 'manager', 'user']);
const accountStatusEnum = pgEnum('account_status', [
  'active',
  'suspended',
  'pending',
]);
const messageRoleEnum = pgEnum('message_role', ['user', 'assistant', 'system']);
const messageStatusEnum = pgEnum('message_status', [
  'sent',
  'delivered',
  'error',
]);

const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(),
  full_name: text('full_name'),
  username: text('username'),
  avatar_url: text('avatar_url'),
  email: text('email'),
  phone: text('phone'),
  auth_source: text('auth_source').notNull().default('password'),
  sso_provider_id: uuid('sso_provider_id'),
  employee_number: text('employee_number'),
  role: userRoleEnum('role').default('user'),
  status: accountStatusEnum('status').default('active'),
  last_login: timestamp('last_login', { withTimezone: true, mode: 'string' }),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

const conversations = pgTable('conversations', {
  id: uuid('id').primaryKey().defaultRandom(),
  user_id: uuid('user_id').notNull(),
  ai_config_id: uuid('ai_config_id'),
  title: text('title').notNull(),
  summary: text('summary'),
  settings: jsonb('settings').$type<Record<string, unknown>>(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  status: text('status'),
  external_id: varchar('external_id', { length: 255 }),
  app_id: varchar('app_id', { length: 255 }),
  last_message_preview: text('last_message_preview'),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

const messages = pgTable('messages', {
  id: uuid('id').primaryKey().defaultRandom(),
  conversation_id: uuid('conversation_id').notNull(),
  user_id: uuid('user_id'),
  role: messageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
  status: messageStatusEnum('status').default('sent'),
  external_id: varchar('external_id', { length: 255 }),
  token_count: integer('token_count'),
  is_synced: boolean('is_synced').default(true),
  sequence_index: integer('sequence_index').default(0),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

const providers = pgTable('providers', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  base_url: text('base_url').notNull(),
  auth_type: text('auth_type').notNull(),
  is_active: boolean('is_active').default(true),
  is_default: boolean('is_default').default(false),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

const serviceInstances = pgTable('service_instances', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider_id: uuid('provider_id').notNull(),
  instance_id: text('instance_id').notNull(),
  api_path: text('api_path'),
  display_name: text('display_name'),
  description: text('description'),
  is_default: boolean('is_default').default(false),
  visibility: text('visibility'),
  config: jsonb('config').$type<Record<string, unknown>>(),
  created_at: timestamp('created_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow(),
});

const managedTables = {
  profiles,
  conversations,
  messages,
  providers,
  service_instances: serviceInstances,
} as const;

export type ManagedTableName = keyof typeof managedTables;

const DRIZZLE_DB_GLOBAL_KEY = '__agentifui_drizzle_db__';

export function isManagedTable(table: string): table is ManagedTableName {
  return Object.prototype.hasOwnProperty.call(managedTables, table);
}

function getDrizzleDb(pool: unknown): DrizzleDb {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[DRIZZLE_DB_GLOBAL_KEY] as DrizzleDb | undefined;
  if (existing) {
    return existing;
  }

  if (!pool) {
    throw new DatabaseError(
      'PostgreSQL pool is required for Drizzle',
      'drizzle'
    );
  }

  const runtimeRequire = eval('require') as (id: string) => unknown;
  const nodePg = runtimeRequire('drizzle-orm/node-postgres') as {
    drizzle: (driver: unknown, options: { schema: object }) => DrizzleDb;
  };
  const db = nodePg.drizzle(pool, { schema: managedTables });
  globalState[DRIZZLE_DB_GLOBAL_KEY] = db;
  return db;
}

function getManagedTableOrThrow(tableName: ManagedTableName) {
  const table = managedTables[tableName];
  if (!table) {
    throw new DatabaseError(
      `Unsupported managed table: ${tableName}`,
      'drizzle'
    );
  }
  return table;
}

function getColumnOrThrow(table: object, column: string) {
  const value = (table as Row)[column];
  if (!value) {
    throw new DatabaseError(`Invalid column: ${column}`, 'sql_guard');
  }
  return value;
}

function buildFilters(table: object, filters: FilterMap): ConditionLike[] {
  const conditions: ConditionLike[] = [];

  Object.entries(filters).forEach(([key, rawValue]) => {
    if (rawValue === undefined) {
      return;
    }

    const column = getColumnOrThrow(table, key) as ColumnLike;
    if (rawValue === null) {
      conditions.push(isNull(column));
      return;
    }

    conditions.push(eq(column, rawValue as never));
  });

  return conditions;
}

function applyWhere(
  query: QueryBuilder,
  conditions: ConditionLike[]
): QueryBuilder {
  if (conditions.length === 1) {
    return query.where(conditions[0]);
  }

  if (conditions.length > 1) {
    return query.where(and(...(conditions as Parameters<typeof and>)));
  }

  return query;
}

function sanitizeWritePayload(table: object, data: Row): Row {
  const payload: Row = {};

  Object.entries(data).forEach(([key, value]) => {
    if (value === undefined) {
      return;
    }

    getColumnOrThrow(table, key);
    payload[key] = value;
  });

  if (Object.keys(payload).length === 0) {
    throw new DatabaseError('Write payload is empty', 'drizzle');
  }

  return payload;
}

export class ManagedCrudRepository {
  constructor(
    private readonly tableName: ManagedTableName,
    private readonly pool: unknown
  ) {}

  private get db(): DrizzleDb {
    return getDrizzleDb(this.pool);
  }

  private get table() {
    return getManagedTableOrThrow(this.tableName);
  }

  async findOne(filters: FilterMap): Promise<Row | null> {
    const conditions = buildFilters(this.table, filters);
    const query = applyWhere(this.db.select().from(this.table), conditions);
    const rows = (await query.limit(1)) as Row[];
    return rows[0] ?? null;
  }

  async findMany(
    filters: FilterMap,
    orderBy?: ManagedOrderByOption,
    pagination?: ManagedPaginationOption
  ): Promise<Row[]> {
    const conditions = buildFilters(this.table, filters);
    let query = applyWhere(this.db.select().from(this.table), conditions);

    if (orderBy) {
      const column = getColumnOrThrow(this.table, orderBy.column) as ColumnLike;
      query = query.orderBy(orderBy.ascending ? asc(column) : desc(column));
    }

    if (pagination) {
      const offset = Math.max(0, Number(pagination.offset || 0));
      const limit = Math.max(0, Number(pagination.limit || 0));
      query = query.offset(offset).limit(limit);
    }

    return (await query) as Row[];
  }

  async create(data: Row): Promise<Row> {
    const payload = sanitizeWritePayload(this.table, data);
    const rows = (await this.db
      .insert(this.table)
      .values(payload)
      .returning()) as Row[];
    const row = rows[0];
    if (!row) {
      throw new DatabaseError('Create returned no row', 'drizzle');
    }
    return row;
  }

  async update(id: string, data: Row): Promise<Row | null> {
    const payload = sanitizeWritePayload(this.table, data);
    const idColumn = getColumnOrThrow(this.table, 'id') as ColumnLike;
    const rows = (await this.db
      .update(this.table)
      .set(payload)
      .where(eq(idColumn, id))
      .returning()) as Row[];
    return rows[0] ?? null;
  }

  async delete(id: string): Promise<void> {
    const idColumn = getColumnOrThrow(this.table, 'id') as ColumnLike;
    await this.db.delete(this.table).where(eq(idColumn, id));
  }

  async count(filters: FilterMap): Promise<number> {
    const conditions = buildFilters(this.table, filters);
    let query = this.db
      .select({ total: sql<number>`COUNT(*)::int` })
      .from(this.table);
    query = applyWhere(query, conditions);
    const rows = (await query.limit(1)) as Array<{ total: number }>;
    return Number(rows[0]?.total ?? 0);
  }
}

export function getManagedCrudRepository(
  tableName: string,
  pool: unknown
): ManagedCrudRepository | null {
  if (!isManagedTable(tableName)) {
    return null;
  }

  return new ManagedCrudRepository(tableName, pool);
}
