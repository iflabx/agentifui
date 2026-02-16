#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Client } from 'pg'
import {
  parseCommaList,
  quoteIdent,
  resolveM7TableList,
  resolveM7TargetDatabaseUrl,
} from './m7-shared.mjs'

const targetDatabaseUrl = resolveM7TargetDatabaseUrl()
const checkpointTable =
  process.env.M7_CHECKPOINT_TABLE?.trim() || 'migration_sync_checkpoints'
const checkpointTableRef = `${quoteIdent('public')}.${quoteIdent(checkpointTable)}`
const tableNames = parseCommaList(
  process.env.M7_INCREMENTAL_TABLES,
  resolveM7TableList()
)

function resolveArgumentValue(args, key) {
  const inline = args.find(value => value.startsWith(`--${key}=`))
  if (inline) {
    return inline.slice(key.length + 3).trim()
  }
  const keyIndex = args.findIndex(value => value === `--${key}`)
  if (keyIndex >= 0) {
    return args[keyIndex + 1]?.trim() || ''
  }
  return ''
}

function parseArgs(argv) {
  const args = argv
    .slice(2)
    .map(value => value.trim())
    .filter(Boolean)
    .filter(value => value !== '--')

  const explicitCheckpoint = resolveArgumentValue(args, 'snapshot')
  const explicitDataSnapshot = resolveArgumentValue(args, 'data-snapshot')
  const explicitDataSnapshotSchema = resolveArgumentValue(
    args,
    'data-snapshot-schema'
  )
  const positionalCheckpoint = args.find(value => !value.startsWith('--')) || ''
  return {
    checkpointSnapshotPath: explicitCheckpoint || positionalCheckpoint,
    dataSnapshotPath: explicitDataSnapshot,
    dataSnapshotSchema: explicitDataSnapshotSchema,
  }
}

const parsedArgs = parseArgs(process.argv)
const snapshotPath =
  process.env.M7_BATCH_CHECKPOINT_SNAPSHOT?.trim() ||
  parsedArgs.checkpointSnapshotPath ||
  ''
const dataSnapshotPath =
  process.env.M7_BATCH_DATA_SNAPSHOT_PATH?.trim() ||
  process.env.M7_BATCH_DATA_SNAPSHOT?.trim() ||
  parsedArgs.dataSnapshotPath ||
  ''
const dataSnapshotSchema =
  process.env.M7_BATCH_DATA_SNAPSHOT_SCHEMA?.trim() ||
  parsedArgs.dataSnapshotSchema ||
  ''

async function runPgUtility(command, args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('close', code => {
      if (code === 0) {
        resolve({
          stdout,
          stderr,
        })
        return
      }
      reject(
        new Error(
          `${label} failed with code ${code}\n${stderr || stdout || '(no output)'}`
        )
      )
    })
  })
}

async function restoreTargetData(snapshotDumpPath) {
  await runPgUtility(
    'pg_restore',
    [
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      '--dbname',
      targetDatabaseUrl,
      snapshotDumpPath,
    ],
    'pg_restore'
  )
}

function tableRef(schemaName, tableName) {
  return `${quoteIdent(schemaName)}.${quoteIdent(tableName)}`
}

async function restoreTargetDataFromSnapshotSchema(targetClient, schemaName) {
  await targetClient.query('BEGIN')
  try {
    const truncateRefs = tableNames
      .map(tableName => tableRef('public', tableName))
      .join(', ')
    await targetClient.query(
      `TRUNCATE TABLE ${truncateRefs} RESTART IDENTITY CASCADE`
    )
    for (const tableName of tableNames) {
      const sourceSnapshotRef = tableRef(schemaName, tableName)
      const targetTableRef = tableRef('public', tableName)
      await targetClient.query(
        `INSERT INTO ${targetTableRef} SELECT * FROM ${sourceSnapshotRef}`
      )
    }
    await targetClient.query('COMMIT')
  } catch (error) {
    await targetClient.query('ROLLBACK')
    throw error
  }
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
  const absoluteDataSnapshotPath = dataSnapshotPath
    ? path.isAbsolute(dataSnapshotPath)
      ? dataSnapshotPath
      : path.join(process.cwd(), dataSnapshotPath)
    : null
  const resolvedDataSnapshotSchema = dataSnapshotSchema || null

  const targetClient = new Client({ connectionString: targetDatabaseUrl })
  await targetClient.connect()
  try {
    if (resolvedDataSnapshotSchema) {
      await restoreTargetDataFromSnapshotSchema(
        targetClient,
        resolvedDataSnapshotSchema
      )
    } else if (absoluteDataSnapshotPath) {
      await restoreTargetData(absoluteDataSnapshotPath)
    }
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
          dataSnapshotRestored: Boolean(
            resolvedDataSnapshotSchema || absoluteDataSnapshotPath
          ),
          dataSnapshotSchema: resolvedDataSnapshotSchema,
          dataSnapshotPath: absoluteDataSnapshotPath,
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
