#!/usr/bin/env node
import pg from 'pg'
import { performance } from 'node:perf_hooks'
import {
  buildPublicTableRef,
  parseBooleanEnv,
  parsePositiveInt,
  quoteIdent,
  resolveM7SourceDatabaseUrl,
  resolveM7TableList,
  resolveM7TargetDatabaseUrl,
} from './m7-shared.mjs'

const { Client, types } = pg
// Preserve timestamp precision during migration; JS Date truncates microseconds.
types.setTypeParser(1114, value => value)
types.setTypeParser(1184, value => value)

const sourceDatabaseUrl = resolveM7SourceDatabaseUrl()
const targetDatabaseUrl = resolveM7TargetDatabaseUrl()
const tableNames = resolveM7TableList()
const dryRun = parseBooleanEnv(process.env.M7_DRY_RUN, true)
const batchSize = parsePositiveInt(process.env.M7_BATCH_SIZE, 1000)

function buildOrderExpression(pkColumns) {
  if (pkColumns.length === 1) {
    return `${quoteIdent(pkColumns[0])} ASC`
  }

  return pkColumns.map(column => `${quoteIdent(column)} ASC`).join(', ')
}

function buildUpsertSql(tableName, columns, pkColumns, rowCount) {
  const tableRef = buildPublicTableRef(tableName)
  const columnSql = columns.map(column => quoteIdent(column)).join(', ')
  const pkSql = pkColumns.map(column => quoteIdent(column)).join(', ')
  const nonPkColumns = columns.filter(column => !pkColumns.includes(column))
  const targetTableName = quoteIdent(tableName)

  const placeholders = []
  const values = []
  for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
    const rowPlaceholders = []
    for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
      rowPlaceholders.push(`$${values.length + columnIndex + 1}`)
    }
    placeholders.push(`(${rowPlaceholders.join(', ')})`)
    values.push(...columns.map(column => ({ column, rowIndex })))
  }

  const onConflictSql =
    nonPkColumns.length > 0
      ? `DO UPDATE SET ${nonPkColumns
          .map(column => `${quoteIdent(column)} = EXCLUDED.${quoteIdent(column)}`)
          .join(', ')} WHERE ${nonPkColumns
          .map(
            column =>
              `${targetTableName}.${quoteIdent(column)} IS DISTINCT FROM EXCLUDED.${quoteIdent(column)}`
          )
          .join(' OR ')}`
      : 'DO NOTHING'

  return {
    text: `INSERT INTO ${tableRef} (${columnSql}) VALUES ${placeholders.join(', ')} ON CONFLICT (${pkSql}) ${onConflictSql}`,
    columns,
  }
}

function buildBatchValues(rows, columns) {
  const values = []
  for (const row of rows) {
    for (const column of columns) {
      values.push(row[column])
    }
  }
  return values
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
  )
  return rows.map(row => row.column_name)
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
  )
  return rows.map(row => row.column_name)
}

async function migrateTable({
  sourceClient,
  targetClient,
  tableName,
  requestedBatchSize,
  dryRunMode,
}) {
  const sourceColumns = await getColumns(sourceClient, tableName)
  const targetColumns = new Set(await getColumns(targetClient, tableName))
  const primaryKeyColumns = await getPrimaryKeyColumns(targetClient, tableName)

  if (sourceColumns.length === 0) {
    throw new Error(`table ${tableName} not found in source database`)
  }
  if (primaryKeyColumns.length === 0) {
    throw new Error(`table ${tableName} has no primary key in target database`)
  }

  const commonColumns = sourceColumns.filter(column => targetColumns.has(column))
  if (commonColumns.length === 0) {
    throw new Error(`table ${tableName} has no common columns`)
  }

  for (const pkColumn of primaryKeyColumns) {
    if (!commonColumns.includes(pkColumn)) {
      throw new Error(`table ${tableName} primary key ${pkColumn} missing in source`)
    }
  }

  const tableRef = buildPublicTableRef(tableName)
  const countResult = await sourceClient.query(
    `SELECT COUNT(*)::bigint AS c FROM ${tableRef}`
  )
  const sourceCount = Number(countResult.rows[0]?.c || 0)
  const maxRowsByParams = Math.max(1, Math.floor(60000 / commonColumns.length))
  const effectiveBatchSize = Math.max(
    1,
    Math.min(requestedBatchSize, maxRowsByParams)
  )

  const startedAt = performance.now()
  let processedRows = 0
  if (!dryRunMode && sourceCount > 0) {
    const columnSql = commonColumns.map(column => quoteIdent(column)).join(', ')
    const orderSql = buildOrderExpression(primaryKeyColumns)
    for (let offset = 0; offset < sourceCount; offset += effectiveBatchSize) {
      const sourceBatch = await sourceClient.query(
        `SELECT ${columnSql}
           FROM ${tableRef}
          ORDER BY ${orderSql}
          LIMIT $1 OFFSET $2`,
        [effectiveBatchSize, offset]
      )
      const rows = sourceBatch.rows
      if (rows.length === 0) {
        break
      }

      const upsert = buildUpsertSql(
        tableName,
        commonColumns,
        primaryKeyColumns,
        rows.length
      )
      const values = buildBatchValues(rows, upsert.columns)
      await targetClient.query('BEGIN')
      try {
        await targetClient.query(upsert.text, values)
        await targetClient.query('COMMIT')
      } catch (error) {
        await targetClient.query('ROLLBACK')
        throw error
      }

      processedRows += rows.length
    }
  }

  return {
    table: tableName,
    dryRun: dryRunMode,
    sourceCount,
    processedRows,
    columns: commonColumns.length,
    primaryKeyColumns,
    batchSize: effectiveBatchSize,
    elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
  }
}

async function run() {
  const sourceClient = new Client({ connectionString: sourceDatabaseUrl })
  const targetClient = new Client({ connectionString: targetDatabaseUrl })
  await sourceClient.connect()
  await targetClient.connect()

  const startedAt = performance.now()
  const tableStats = []
  try {
    for (const tableName of tableNames) {
      // Keep migration deterministic by table order to reduce FK surprises.
      const tableResult = await migrateTable({
        sourceClient,
        targetClient,
        tableName,
        requestedBatchSize: batchSize,
        dryRunMode: dryRun,
      })
      tableStats.push(tableResult)
    }

    const totalSourceRows = tableStats.reduce(
      (sum, item) => sum + item.sourceCount,
      0
    )
    const totalProcessedRows = tableStats.reduce(
      (sum, item) => sum + item.processedRows,
      0
    )

    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: dryRun ? 'dry-run' : 'apply',
          sourceDatabaseUrl,
          targetDatabaseUrl,
          tables: tableStats,
          totals: {
            sourceRows: totalSourceRows,
            processedRows: totalProcessedRows,
            elapsedMs: Number((performance.now() - startedAt).toFixed(2)),
          },
        },
        null,
        2
      )
    )
  } finally {
    await sourceClient.end().catch(() => {})
    await targetClient.end().catch(() => {})
  }
}

run().catch(error => {
  console.error(
    `[m7-data-migrate] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
