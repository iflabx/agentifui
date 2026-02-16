#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Client } from 'pg'
import { quoteIdent, resolveM7TargetDatabaseUrl } from './m7-shared.mjs'

const targetDatabaseUrl = resolveM7TargetDatabaseUrl()
const checkpointTable =
  process.env.M7_CHECKPOINT_TABLE?.trim() || 'migration_sync_checkpoints'
const checkpointTableRef = `${quoteIdent('public')}.${quoteIdent(checkpointTable)}`

function resolveSnapshotPathFromArgs(argv) {
  const args = argv
    .slice(2)
    .map(value => value.trim())
    .filter(Boolean)
    .filter(value => value !== '--')

  if (args.length === 0) {
    return ''
  }

  const snapshotFlag = args.find(value => value.startsWith('--snapshot='))
  if (snapshotFlag) {
    return snapshotFlag.slice('--snapshot='.length).trim()
  }

  const snapshotFlagIndex = args.findIndex(value => value === '--snapshot')
  if (snapshotFlagIndex >= 0) {
    return args[snapshotFlagIndex + 1]?.trim() || ''
  }

  return args[0]
}

const snapshotPath =
  process.env.M7_BATCH_CHECKPOINT_SNAPSHOT?.trim() ||
  resolveSnapshotPathFromArgs(process.argv) ||
  ''

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
  `)
}

async function restoreCheckpointRows(targetClient, pipelineName, rows) {
  await targetClient.query('BEGIN')
  try {
    await targetClient.query(
      `
        DELETE FROM ${checkpointTableRef}
        WHERE pipeline_name = $1
      `,
      [pipelineName]
    )

    for (const row of rows) {
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
          VALUES (
            $1,
            $2,
            $3,
            $4::timestamptz,
            $5,
            $6::bigint,
            $7::timestamptz,
            $8::timestamptz
          )
        `,
        [
          row.pipelineName,
          row.tableName,
          row.watermarkColumn,
          row.lastWatermark,
          row.lastPrimaryKey,
          row.rowsProcessed,
          row.createdAt,
          row.updatedAt,
        ]
      )
    }

    await targetClient.query('COMMIT')
  } catch (error) {
    await targetClient.query('ROLLBACK')
    throw error
  }
}

async function run() {
  if (!snapshotPath) {
    throw new Error('snapshot path required: set M7_BATCH_CHECKPOINT_SNAPSHOT or pass as arg')
  }

  const absoluteSnapshotPath = path.isAbsolute(snapshotPath)
    ? snapshotPath
    : path.join(process.cwd(), snapshotPath)
  const snapshotRaw = await readFile(absoluteSnapshotPath, 'utf8')
  const snapshot = JSON.parse(snapshotRaw)
  const pipelineName = snapshot.pipelineName || 'default'
  const rows = Array.isArray(snapshot.rows) ? snapshot.rows : []

  const targetClient = new Client({ connectionString: targetDatabaseUrl })
  await targetClient.connect()
  try {
    await ensureCheckpointTable(targetClient)
    await restoreCheckpointRows(targetClient, pipelineName, rows)
    console.log(
      JSON.stringify(
        {
          ok: true,
          targetDatabaseUrl,
          checkpointTable,
          pipelineName,
          restoredRows: rows.length,
          snapshotPath: absoluteSnapshotPath,
        },
        null,
        2
      )
    )
  } finally {
    await targetClient.end().catch(() => {})
  }
}

run().catch(error => {
  console.error(
    `[m7-batch-rollback] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
