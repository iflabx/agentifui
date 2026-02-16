#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { Client } from 'pg'
import { parseBooleanEnv, quoteIdent, resolveM7TargetDatabaseUrl } from './m7-shared.mjs'

const targetDatabaseUrl = resolveM7TargetDatabaseUrl()
const pipelineName = process.env.M7_PIPELINE_NAME?.trim() || 'default'
const checkpointTable =
  process.env.M7_CHECKPOINT_TABLE?.trim() || 'migration_sync_checkpoints'
const checkpointTableRef = `${quoteIdent('public')}.${quoteIdent(checkpointTable)}`

const batchId =
  process.env.M7_BATCH_ID?.trim() ||
  new Date().toISOString().replaceAll(':', '').replaceAll('-', '').replace(/\.\d{3}Z$/, 'Z')
const batchDir =
  process.env.M7_BATCH_DIR?.trim() ||
  path.join(process.cwd(), 'artifacts', 'm7', 'batches', batchId)

const batchApproved = parseBooleanEnv(process.env.M7_BATCH_APPROVED, false)
const autoRollback = parseBooleanEnv(process.env.M7_BATCH_AUTO_ROLLBACK, true)

function extractTrailingJson(text) {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  const end = trimmed.lastIndexOf('}')
  if (end < 0) {
    return null
  }

  for (
    let start = trimmed.lastIndexOf('{', end);
    start >= 0;
    start = trimmed.lastIndexOf('{', start - 1)
  ) {
    const candidate = trimmed.slice(start, end + 1)
    try {
      return JSON.parse(candidate)
    } catch {
      // continue scanning older braces
    }
  }

  return null
}

async function runCommand(step) {
  const startedAt = performance.now()
  return new Promise(resolve => {
    const child = spawn(step.command[0], step.command.slice(1), {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...step.env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      const text = chunk.toString()
      stdout += text
      process.stdout.write(text)
    })
    child.stderr.on('data', chunk => {
      const text = chunk.toString()
      stderr += text
      process.stderr.write(text)
    })

    child.on('close', code => {
      const payload = extractTrailingJson(stdout)
      const ok =
        code === 0 &&
        payload &&
        (typeof payload.ok !== 'boolean' || payload.ok === true)
      resolve({
        id: step.id,
        command: step.command.join(' '),
        exitCode: code,
        ok: Boolean(ok),
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        stdout,
        stderr,
        payload,
      })
    })
  })
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

async function readCheckpointRows(targetClient) {
  const { rows } = await targetClient.query(
    `
      SELECT
        pipeline_name,
        table_name,
        watermark_column,
        last_watermark::text AS last_watermark,
        COALESCE(last_primary_key, '') AS last_primary_key,
        rows_processed::bigint AS rows_processed,
        created_at::text AS created_at,
        updated_at::text AS updated_at
      FROM ${checkpointTableRef}
      WHERE pipeline_name = $1
      ORDER BY table_name ASC
    `,
    [pipelineName]
  )
  return rows.map(row => ({
    pipelineName: row.pipeline_name,
    tableName: row.table_name,
    watermarkColumn: row.watermark_column,
    lastWatermark: row.last_watermark,
    lastPrimaryKey: row.last_primary_key,
    rowsProcessed: Number(row.rows_processed || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

async function restoreCheckpointRows(targetClient, snapshotRows) {
  await targetClient.query('BEGIN')
  try {
    await targetClient.query(
      `
        DELETE FROM ${checkpointTableRef}
        WHERE pipeline_name = $1
      `,
      [pipelineName]
    )

    for (const row of snapshotRows) {
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
  if (!batchApproved) {
    throw new Error('M7_BATCH_APPROVED=1 is required before batch apply')
  }

  await mkdir(batchDir, { recursive: true })
  const targetClient = new Client({ connectionString: targetDatabaseUrl })
  await targetClient.connect()

  const startedAt = performance.now()
  let rollbackPerformed = false
  let failureReason = null
  const results = []

  try {
    await ensureCheckpointTable(targetClient)
    const checkpointBefore = await readCheckpointRows(targetClient)
    await writeFile(
      path.join(batchDir, 'checkpoint-before.json'),
      JSON.stringify(
        {
          batchId,
          pipelineName,
          checkpointTable,
          rows: checkpointBefore,
        },
        null,
        2
      ),
      'utf8'
    )

    const steps = [
      {
        id: 'incremental-apply',
        command: ['node', 'scripts/m7-incremental-migrate.mjs'],
        env: {
          M7_DRY_RUN: '0',
        },
      },
      {
        id: 'db-reconcile',
        command: ['node', 'scripts/m7-reconcile-verify.mjs'],
        env: {},
      },
      {
        id: 'dual-read',
        command: ['node', 'scripts/m7-dual-read-verify.mjs'],
        env: {},
      },
      {
        id: 'storage-reconcile',
        command: ['node', 'scripts/m7-storage-reconcile-verify.mjs'],
        env: {},
      },
      {
        id: 'lag-verify',
        command: ['node', 'scripts/m7-lag-verify.mjs'],
        env: {},
      },
    ]

    for (const step of steps) {
      const result = await runCommand(step)
      results.push(result)
      await writeFile(
        path.join(batchDir, `${result.id}.stdout.log`),
        result.stdout,
        'utf8'
      )
      await writeFile(
        path.join(batchDir, `${result.id}.stderr.log`),
        result.stderr,
        'utf8'
      )
      await writeFile(
        path.join(batchDir, `${result.id}.json`),
        JSON.stringify(result.payload || { ok: false, parseError: true }, null, 2),
        'utf8'
      )

      if (!result.ok) {
        failureReason = `${result.id} failed`
        break
      }
    }

    if (failureReason && autoRollback) {
      const beforeRaw = await readFile(
        path.join(batchDir, 'checkpoint-before.json'),
        'utf8'
      )
      const before = JSON.parse(beforeRaw)
      await restoreCheckpointRows(targetClient, before.rows || [])
      rollbackPerformed = true
      const checkpointAfterRollback = await readCheckpointRows(targetClient)
      await writeFile(
        path.join(batchDir, 'checkpoint-after-rollback.json'),
        JSON.stringify(
          {
            batchId,
            pipelineName,
            checkpointTable,
            rows: checkpointAfterRollback,
          },
          null,
          2
        ),
        'utf8'
      )
    }

    if (!failureReason) {
      const checkpointAfter = await readCheckpointRows(targetClient)
      await writeFile(
        path.join(batchDir, 'checkpoint-after.json'),
        JSON.stringify(
          {
            batchId,
            pipelineName,
            checkpointTable,
            rows: checkpointAfter,
          },
          null,
          2
        ),
        'utf8'
      )
    }

    const summary = {
      ok: !failureReason,
      batchId,
      pipelineName,
      checkpointTable,
      batchDir,
      autoRollback,
      rollbackPerformed,
      failureReason,
      totalDurationMs: Number((performance.now() - startedAt).toFixed(2)),
      steps: results.map(result => ({
        id: result.id,
        ok: result.ok,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      })),
    }

    await writeFile(
      path.join(batchDir, 'summary.json'),
      JSON.stringify(summary, null, 2),
      'utf8'
    )

    console.log(JSON.stringify(summary, null, 2))
    if (!summary.ok) {
      process.exitCode = 1
    }
  } finally {
    await targetClient.end().catch(() => {})
  }
}

run().catch(error => {
  console.error(
    `[m7-batch-apply] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
