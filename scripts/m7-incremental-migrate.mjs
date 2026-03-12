#!/usr/bin/env node
import { performance } from 'node:perf_hooks';
import pg from 'pg';

import {
  assertSourceTargetIsolation,
  buildPublicTableRef,
  parseBooleanEnv,
  parseCommaList,
  parsePositiveInt,
  quoteIdent,
  resolveM7SourceDatabaseUrl,
  resolveM7TableList,
  resolveM7TargetDatabaseUrl,
} from './m7-shared.mjs';

const { Client, types } = pg;
// Preserve timestamp precision during migration; JS Date truncates microseconds.
types.setTypeParser(1114, value => value);
types.setTypeParser(1184, value => value);

const sourceDatabaseUrl = resolveM7SourceDatabaseUrl();
const targetDatabaseUrl = resolveM7TargetDatabaseUrl();
const tableNames = parseCommaList(
  process.env.M7_INCREMENTAL_TABLES,
  resolveM7TableList()
);
const dryRun = parseBooleanEnv(process.env.M7_DRY_RUN, true);
const allowSameSourceTarget = parseBooleanEnv(
  process.env.M7_ALLOW_SAME_SOURCE_TARGET,
  false
);
const batchSize = parsePositiveInt(process.env.M7_BATCH_SIZE, 1000);
const pipelineName = process.env.M7_PIPELINE_NAME?.trim() || 'default';
const checkpointTable =
  process.env.M7_CHECKPOINT_TABLE?.trim() || 'migration_sync_checkpoints';
const checkpointTableRef = `${quoteIdent('public')}.${quoteIdent(checkpointTable)}`;
const lockEnabled = !parseBooleanEnv(process.env.M7_DISABLE_LOCK, false);
const lockKey =
  process.env.M7_LOCK_KEY?.trim() || `m7:incremental:${pipelineName}`;

function buildUpsertSql(tableName, columns, pkColumns, rowCount) {
  const tableRef = buildPublicTableRef(tableName);
  const columnSql = columns.map(column => quoteIdent(column)).join(', ');
  const pkSql = pkColumns.map(column => quoteIdent(column)).join(', ');
  const nonPkColumns = columns.filter(column => !pkColumns.includes(column));
  const targetTableName = quoteIdent(tableName);

  const placeholders = [];
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowPlaceholders = [];
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      rowPlaceholders.push(`$${rowIndex * columns.length + columnIndex + 1}`);
    }
    placeholders.push(`(${rowPlaceholders.join(', ')})`);
  }

  const onConflictSql =
    nonPkColumns.length > 0
      ? `DO UPDATE SET ${nonPkColumns
          .map(
            column => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`
          )
          .join(', ')} WHERE ${nonPkColumns
          .map(
            column =>
              `${targetTableName}.${quoteIdent(column)} IS DISTINCT FROM EXCLUDED.${quoteIdent(column)}`
          )
          .join(' OR ')}`
      : 'DO NOTHING';

  return {
    text: `INSERT INTO ${tableRef} (${columnSql}) VALUES ${placeholders.join(', ')} ON CONFLICT (${pkSql}) ${onConflictSql}`,
    columns,
  };
}

function buildBatchValues(rows, columns) {
  const values = [];
  for (const row of rows) {
    for (const column of columns) {
      values.push(row[column]);
    }
  }
  return values;
}

async function getColumns(client, tableName) {
  const { rows } = await client.query(
    `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1
      ORDER BY ordinal_position
    `,
    [tableName]
  );
  return rows.map(row => row.column_name);
}

async function getPrimaryKeyColumns(client, tableName) {
  const { rows } = await client.query(
    `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = $1
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `,
    [tableName]
  );
  return rows.map(row => row.column_name);
}

async function ensureCheckpointTable(targetClient) {
  await targetClient.query(`
    CREATE TABLE IF NOT EXISTS ${checkpointTableRef} (
      pipeline_name text NOT NULL,
      table_name text NOT NULL,
      watermark_column text NOT NULL,
      last_watermark timestamp with time zone,
      last_primary_key text,
      rows_processed bigint NOT NULL DEFAULT 0,
      created_at timestamp with time zone NOT NULL DEFAULT now(),
      updated_at timestamp with time zone NOT NULL DEFAULT now(),
      PRIMARY KEY (pipeline_name, table_name)
    )
  `);
}

async function acquireAdvisoryLock(client, lockName) {
  const { rows } = await client.query(
    `
      SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked
    `,
    [lockName]
  );
  if (!rows[0]?.locked) {
    throw new Error(
      `advisory lock already held for ${lockName}; another incremental migration may be running`
    );
  }
}

async function releaseAdvisoryLock(client, lockName) {
  await client.query(
    `
      SELECT pg_advisory_unlock(hashtextextended($1, 0))
    `,
    [lockName]
  );
}

async function loadCheckpoint(targetClient, tableName) {
  const { rows } = await targetClient.query(
    `
      SELECT
        last_watermark::text AS last_watermark_text,
        COALESCE(last_primary_key, '') AS last_primary_key,
        rows_processed::bigint AS rows_processed
      FROM ${checkpointTableRef}
      WHERE pipeline_name = $1
        AND table_name = $2
      LIMIT 1
    `,
    [pipelineName, tableName]
  );
  if (rows.length === 0) {
    return {
      exists: false,
      lastWatermark: '1970-01-01T00:00:00+00',
      lastPrimaryKey: '',
      rowsProcessed: 0,
    };
  }

  return {
    exists: true,
    lastWatermark: rows[0].last_watermark_text || '1970-01-01T00:00:00+00',
    lastPrimaryKey: rows[0].last_primary_key || '',
    rowsProcessed: Number(rows[0].rows_processed || 0),
  };
}

async function updateCheckpoint({
  targetClient,
  tableName,
  watermarkColumn,
  lastWatermark,
  lastPrimaryKey,
  deltaRows,
}) {
  await targetClient.query(
    `
      INSERT INTO ${checkpointTableRef} (
        pipeline_name,
        table_name,
        watermark_column,
        last_watermark,
        last_primary_key,
        rows_processed,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4::timestamptz, $5, $6::bigint, now(), now())
      ON CONFLICT (pipeline_name, table_name) DO UPDATE
      SET watermark_column = EXCLUDED.watermark_column,
          last_watermark = EXCLUDED.last_watermark,
          last_primary_key = EXCLUDED.last_primary_key,
          rows_processed = ${checkpointTableRef}.rows_processed + EXCLUDED.rows_processed,
          updated_at = now()
    `,
    [
      pipelineName,
      tableName,
      watermarkColumn,
      lastWatermark,
      lastPrimaryKey,
      deltaRows,
    ]
  );
}

function resolveWatermarkColumn(sourceColumns, targetColumns) {
  const candidates = ['updated_at', 'created_at'];
  for (const candidate of candidates) {
    if (sourceColumns.includes(candidate) && targetColumns.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

async function getIncrementalBoundary(
  sourceClient,
  tableName,
  watermarkColumn
) {
  const tableRef = buildPublicTableRef(tableName);
  const watermarkSql = quoteIdent(watermarkColumn);
  const { rows } = await sourceClient.query(
    `
      SELECT MAX(${watermarkSql})::text AS boundary
      FROM ${tableRef}
    `
  );
  return rows[0]?.boundary || null;
}

async function getEligibleCount(
  sourceClient,
  tableName,
  watermarkColumn,
  primaryKeyColumn,
  checkpoint,
  boundary
) {
  const tableRef = buildPublicTableRef(tableName);
  const watermarkSql = quoteIdent(watermarkColumn);
  const pkSql = quoteIdent(primaryKeyColumn);
  const { rows } = await sourceClient.query(
    `
      SELECT COUNT(*)::bigint AS c
      FROM ${tableRef}
      WHERE (
        ${watermarkSql} > $1::timestamptz
        OR (
          ${watermarkSql} = $1::timestamptz
          AND ${pkSql}::text > $2::text
        )
      )
      AND ${watermarkSql} <= $3::timestamptz
    `,
    [checkpoint.lastWatermark, checkpoint.lastPrimaryKey, boundary]
  );
  return Number(rows[0]?.c || 0);
}

async function migrateTableIncremental({
  sourceClient,
  targetClient,
  tableName,
  requestedBatchSize,
  dryRunMode,
}) {
  const sourceColumns = await getColumns(sourceClient, tableName);
  const targetColumns = new Set(await getColumns(targetClient, tableName));
  const primaryKeyColumns = await getPrimaryKeyColumns(targetClient, tableName);
  if (sourceColumns.length === 0) {
    throw new Error(`table ${tableName} not found in source database`);
  }
  if (primaryKeyColumns.length !== 1) {
    throw new Error(
      `table ${tableName} must have exactly one primary key for incremental migration`
    );
  }

  const primaryKeyColumn = primaryKeyColumns[0];
  const commonColumns = sourceColumns.filter(column =>
    targetColumns.has(column)
  );
  if (!commonColumns.includes(primaryKeyColumn)) {
    throw new Error(
      `table ${tableName} primary key ${primaryKeyColumn} missing`
    );
  }

  const watermarkColumn = resolveWatermarkColumn(sourceColumns, targetColumns);
  if (!watermarkColumn) {
    return {
      table: tableName,
      dryRun: dryRunMode,
      status: 'skipped_no_watermark',
      reason: 'missing updated_at/created_at',
      primaryKeyColumn,
      columns: commonColumns.length,
      processedRows: 0,
      eligibleRows: 0,
      elapsedMs: 0,
    };
  }

  const startedAt = performance.now();
  const checkpoint = await loadCheckpoint(targetClient, tableName);
  const boundary = await getIncrementalBoundary(
    sourceClient,
    tableName,
    watermarkColumn
  );
  if (!boundary) {
    return {
      table: tableName,
      dryRun: dryRunMode,
      status: 'no_data',
      watermarkColumn,
      primaryKeyColumn,
      columns: commonColumns.length,
      checkpointBefore: checkpoint,
      checkpointAfter: checkpoint,
      processedRows: 0,
      eligibleRows: 0,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    };
  }

  const eligibleRows = await getEligibleCount(
    sourceClient,
    tableName,
    watermarkColumn,
    primaryKeyColumn,
    checkpoint,
    boundary
  );
  if (eligibleRows === 0) {
    return {
      table: tableName,
      dryRun: dryRunMode,
      status: 'no_change',
      watermarkColumn,
      primaryKeyColumn,
      columns: commonColumns.length,
      checkpointBefore: checkpoint,
      checkpointAfter: checkpoint,
      boundary,
      processedRows: 0,
      eligibleRows: 0,
      elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
    };
  }

  const maxRowsByParams = Math.max(1, Math.floor(60000 / commonColumns.length));
  const effectiveBatchSize = Math.max(
    1,
    Math.min(requestedBatchSize, maxRowsByParams)
  );
  const tableRef = buildPublicTableRef(tableName);
  const columnsSql = commonColumns.map(column => quoteIdent(column)).join(', ');
  const watermarkSql = quoteIdent(watermarkColumn);
  const pkSql = quoteIdent(primaryKeyColumn);

  let cursorWatermark = checkpoint.lastWatermark;
  let cursorPrimaryKey = checkpoint.lastPrimaryKey || '';
  let processedRows = 0;

  while (true) {
    const batchResult = await sourceClient.query(
      `
        SELECT
          ${columnsSql},
          ${watermarkSql}::text AS __watermark_text,
          ${pkSql}::text AS __primary_key_text
        FROM ${tableRef}
        WHERE (
          ${watermarkSql} > $1::timestamptz
          OR (
            ${watermarkSql} = $1::timestamptz
            AND ${pkSql}::text > $2::text
          )
        )
          AND ${watermarkSql} <= $3::timestamptz
        ORDER BY ${watermarkSql} ASC, ${pkSql}::text ASC
        LIMIT $4
      `,
      [cursorWatermark, cursorPrimaryKey, boundary, effectiveBatchSize]
    );

    const rows = batchResult.rows;
    if (rows.length === 0) {
      break;
    }

    const lastRow = rows[rows.length - 1];
    cursorWatermark = lastRow.__watermark_text;
    cursorPrimaryKey = lastRow.__primary_key_text || '';

    if (!dryRunMode) {
      const upsertRows = rows.map(row => {
        const sanitized = {};
        for (const column of commonColumns) {
          sanitized[column] = row[column];
        }
        return sanitized;
      });
      const upsert = buildUpsertSql(
        tableName,
        commonColumns,
        [primaryKeyColumn],
        upsertRows.length
      );
      const values = buildBatchValues(upsertRows, upsert.columns);
      await targetClient.query('BEGIN');
      try {
        await targetClient.query(upsert.text, values);
        await targetClient.query('COMMIT');
      } catch (error) {
        await targetClient.query('ROLLBACK');
        throw error;
      }
    }

    processedRows += rows.length;
  }

  const checkpointAfter = {
    exists: true,
    lastWatermark: cursorWatermark,
    lastPrimaryKey: cursorPrimaryKey,
    rowsProcessed: checkpoint.rowsProcessed + processedRows,
  };

  if (!dryRunMode && processedRows > 0) {
    await updateCheckpoint({
      targetClient,
      tableName,
      watermarkColumn,
      lastWatermark: cursorWatermark,
      lastPrimaryKey: cursorPrimaryKey,
      deltaRows: processedRows,
    });
  }

  return {
    table: tableName,
    dryRun: dryRunMode,
    status: 'migrated',
    watermarkColumn,
    primaryKeyColumn,
    columns: commonColumns.length,
    boundary,
    checkpointBefore: checkpoint,
    checkpointAfter: dryRunMode ? checkpointAfter : checkpointAfter,
    processedRows,
    eligibleRows,
    batchSize: effectiveBatchSize,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
  };
}

async function run() {
  assertSourceTargetIsolation({
    sourceDatabaseUrl,
    targetDatabaseUrl,
    allowSameSourceTarget,
    context: 'm7-incremental-migrate',
  });

  const sourceClient = new Client({ connectionString: sourceDatabaseUrl });
  const targetClient = new Client({ connectionString: targetDatabaseUrl });
  await sourceClient.connect();
  await targetClient.connect();

  const startedAt = performance.now();
  const tables = [];
  let lockAcquired = false;
  try {
    if (lockEnabled) {
      await acquireAdvisoryLock(targetClient, lockKey);
      lockAcquired = true;
    }
    await ensureCheckpointTable(targetClient);

    for (const tableName of tableNames) {
      const tableResult = await migrateTableIncremental({
        sourceClient,
        targetClient,
        tableName,
        requestedBatchSize: batchSize,
        dryRunMode: dryRun,
      });
      tables.push(tableResult);
    }

    const processedRows = tables.reduce(
      (sum, table) => sum + Number(table.processedRows || 0),
      0
    );
    const eligibleRows = tables.reduce(
      (sum, table) => sum + Number(table.eligibleRows || 0),
      0
    );
    const skippedTables = tables.filter(table =>
      table.status.startsWith('skipped')
    );
    const migratedTables = tables.filter(table => table.status === 'migrated');
    const checks = {
      processedWithinEligible: processedRows <= eligibleRows,
      noUnexpectedSkip: skippedTables.length === 0,
    };

    const payload = {
      ok: Object.values(checks).every(Boolean),
      mode: dryRun ? 'dry-run' : 'apply',
      sourceDatabaseUrl,
      targetDatabaseUrl,
      pipelineName,
      checkpointTable,
      lock: {
        enabled: lockEnabled,
        key: lockKey,
        acquired: lockAcquired,
      },
      checks,
      totals: {
        eligibleRows,
        processedRows,
        migratedTables: migratedTables.length,
        skippedTables: skippedTables.length,
        elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
      },
      tables,
    };

    console.log(JSON.stringify(payload, null, 2));
    if (!payload.ok) {
      process.exitCode = 1;
    }
  } finally {
    if (lockAcquired) {
      await releaseAdvisoryLock(targetClient, lockKey).catch(() => {});
    }
    await sourceClient.end().catch(() => {});
    await targetClient.end().catch(() => {});
  }
}

run().catch(error => {
  console.error(
    `[m7-incremental-migrate] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
