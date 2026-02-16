#!/usr/bin/env node
import { Client } from 'pg'
import {
  assertSourceTargetIsolation,
  parseBooleanEnv,
  parseCommaList,
  quoteIdent,
  resolveM7SourceDatabaseUrl,
  resolveM7TableList,
  resolveM7TargetDatabaseUrl,
} from './m7-shared.mjs'

const sourceDatabaseUrl = resolveM7SourceDatabaseUrl()
const targetDatabaseUrl = resolveM7TargetDatabaseUrl()
const allowSameSourceTarget = parseBooleanEnv(
  process.env.M7_ALLOW_SAME_SOURCE_TARGET,
  false
)
const tableNames = parseCommaList(
  process.env.M7_INCREMENTAL_TABLES,
  resolveM7TableList()
)
const pipelineName = process.env.M7_PIPELINE_NAME?.trim() || 'default'
const checkpointTable =
  process.env.M7_CHECKPOINT_TABLE?.trim() || 'migration_sync_checkpoints'
const maxLagSeconds = Number(process.env.M7_MAX_LAG_SECONDS || 300)
const requireCheckpoint = parseBooleanEnv(
  process.env.M7_LAG_REQUIRE_CHECKPOINT,
  true
)

function toLagSeconds(sourceMaxText, checkpointText) {
  if (!sourceMaxText || !checkpointText) {
    return null
  }
  const sourceMs = Date.parse(sourceMaxText)
  const checkpointMs = Date.parse(checkpointText)
  if (!Number.isFinite(sourceMs) || !Number.isFinite(checkpointMs)) {
    return null
  }
  return Math.max(0, Number(((sourceMs - checkpointMs) / 1000).toFixed(3)))
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

function resolveWatermarkColumn(columns) {
  if (columns.includes('updated_at')) {
    return 'updated_at'
  }
  if (columns.includes('created_at')) {
    return 'created_at'
  }
  return null
}

async function getSourceMetrics(sourceClient, tableName, watermarkColumn) {
  const tableRef = `${quoteIdent('public')}.${quoteIdent(tableName)}`
  const watermarkRef = quoteIdent(watermarkColumn)
  const { rows } = await sourceClient.query(
    `
      SELECT
        COUNT(*)::bigint AS c,
        MAX(${watermarkRef})::text AS max_watermark
      FROM ${tableRef}
    `
  )
  return {
    count: Number(rows[0]?.c || 0),
    maxWatermark: rows[0]?.max_watermark || null,
  }
}

async function loadCheckpoint(targetClient, tableName) {
  const checkpointTableRef = `${quoteIdent('public')}.${quoteIdent(checkpointTable)}`
  const { rows } = await targetClient.query(
    `
      SELECT
        last_watermark::text AS last_watermark,
        COALESCE(last_primary_key, '') AS last_primary_key,
        rows_processed::bigint AS rows_processed
      FROM ${checkpointTableRef}
      WHERE pipeline_name = $1
        AND table_name = $2
      LIMIT 1
    `,
    [pipelineName, tableName]
  )
  if (rows.length === 0) {
    return null
  }
  return {
    lastWatermark: rows[0].last_watermark || null,
    lastPrimaryKey: rows[0].last_primary_key || '',
    rowsProcessed: Number(rows[0].rows_processed || 0),
  }
}

async function run() {
  assertSourceTargetIsolation({
    sourceDatabaseUrl,
    targetDatabaseUrl,
    allowSameSourceTarget,
    context: 'm7-lag-verify',
  })

  const sourceClient = new Client({ connectionString: sourceDatabaseUrl })
  const targetClient = new Client({ connectionString: targetDatabaseUrl })
  await sourceClient.connect()
  await targetClient.connect()

  const tables = []
  try {
    for (const tableName of tableNames) {
      const columns = await getColumns(sourceClient, tableName)
      const watermarkColumn = resolveWatermarkColumn(columns)
      if (!watermarkColumn) {
        tables.push({
          table: tableName,
          status: 'skipped_no_watermark',
          watermarkColumn: null,
          sourceCount: null,
          sourceMaxWatermark: null,
          checkpoint: null,
          lagSeconds: null,
          lagWithinThreshold: true,
          checkpointPresent: true,
        })
        continue
      }

      const sourceMetrics = await getSourceMetrics(
        sourceClient,
        tableName,
        watermarkColumn
      )
      const checkpoint = await loadCheckpoint(targetClient, tableName)
      const lagSeconds = toLagSeconds(
        sourceMetrics.maxWatermark,
        checkpoint?.lastWatermark || null
      )
      const checkpointPresent = Boolean(checkpoint)
      const lagWithinThreshold =
        lagSeconds === null ? false : lagSeconds <= maxLagSeconds

      let status = 'ok'
      if (sourceMetrics.count === 0) {
        status = 'no_data'
      } else if (!checkpointPresent) {
        status = 'checkpoint_missing'
      } else if (!lagWithinThreshold) {
        status = 'lag_exceeded'
      }

      tables.push({
        table: tableName,
        status,
        watermarkColumn,
        sourceCount: sourceMetrics.count,
        sourceMaxWatermark: sourceMetrics.maxWatermark,
        checkpoint: checkpoint
          ? {
              lastWatermark: checkpoint.lastWatermark,
              lastPrimaryKey: checkpoint.lastPrimaryKey,
              rowsProcessed: checkpoint.rowsProcessed,
            }
          : null,
        lagSeconds,
        lagWithinThreshold,
        checkpointPresent,
      })
    }

    const lagChecks = tables.filter(
      table =>
        table.status !== 'no_data' && table.status !== 'skipped_no_watermark'
    )
    const checks = {
      checkpointCoverageOk: requireCheckpoint
        ? lagChecks.every(table => table.checkpointPresent)
        : true,
      lagWithinThreshold: lagChecks.every(table =>
        table.checkpointPresent ? table.lagWithinThreshold : !requireCheckpoint
      ),
    }

    const ok = Object.values(checks).every(Boolean)
    const payload = {
      ok,
      sourceDatabaseUrl,
      targetDatabaseUrl,
      config: {
        pipelineName,
        checkpointTable,
        maxLagSeconds,
        requireCheckpoint,
      },
      checks,
      tables,
    }

    console.log(JSON.stringify(payload, null, 2))
    if (!ok) {
      process.exitCode = 1
    }
  } finally {
    await sourceClient.end().catch(() => {})
    await targetClient.end().catch(() => {})
  }
}

run().catch(error => {
  console.error(
    `[m7-lag-verify] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
