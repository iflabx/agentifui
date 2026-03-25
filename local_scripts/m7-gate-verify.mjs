#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseBooleanEnv } from './m7-shared.mjs'

const gateTimestamp = new Date()
  .toISOString()
  .replaceAll(':', '')
  .replaceAll('-', '')
  .replace(/\.\d{3}Z$/, 'Z')
const reportDir =
  process.env.M7_REPORT_DIR?.trim() ||
  path.join(process.cwd(), 'artifacts', 'm7', gateTimestamp)

function extractTrailingJson(text) {
  const trimmed = text.trim()
  if (!trimmed) {
    return null
  }

  const end = trimmed.lastIndexOf('}')
  if (end < 0) {
    return null
  }

  for (let start = trimmed.lastIndexOf('{', end); start >= 0; start = trimmed.lastIndexOf('{', start - 1)) {
    const candidate = trimmed.slice(start, end + 1)
    try {
      return JSON.parse(candidate)
    } catch {
      // Continue scanning backward until a valid JSON object is found.
    }
  }

  return null
}

async function runCheck(check) {
  const startedAt = performance.now()
  return new Promise(resolve => {
    const child = spawn(check.command[0], check.command.slice(1), {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...check.env,
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
      const checkOk =
        code === 0 &&
        payload &&
        (typeof payload.ok !== 'boolean' || payload.ok === true)
      resolve({
        id: check.id,
        command: check.command.join(' '),
        exitCode: code,
        ok: Boolean(checkOk),
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        stdout,
        stderr,
        payload,
      })
    })
  })
}

function renderSummaryMarkdown(summary) {
  const lines = []
  lines.push('# M7 Gate Summary')
  lines.push('')
  lines.push(`- Timestamp: ${summary.timestamp}`)
  lines.push(`- Report Dir: ${summary.reportDir}`)
  lines.push(`- Overall: ${summary.ok ? 'PASS' : 'FAIL'}`)
  lines.push('')
  lines.push('| Check | Status | Duration(ms) | Exit |')
  lines.push('| --- | --- | ---: | ---: |')
  for (const check of summary.checks) {
    lines.push(
      `| ${check.id} | ${check.ok ? 'PASS' : 'FAIL'} | ${check.durationMs} | ${check.exitCode} |`
    )
  }
  lines.push('')
  return lines.join('\n')
}

async function run() {
  const checks = []
  if (parseBooleanEnv(process.env.M7_GATE_RUN_MIGRATION_DRY_RUN, true)) {
    checks.push({
      id: 'full-migrate-dry-run',
      command: ['node', 'local_scripts/m7-data-migrate.mjs'],
      env: { M7_DRY_RUN: '1' },
    })
  }

  if (parseBooleanEnv(process.env.M7_GATE_RUN_INCREMENTAL_DRY_RUN, true)) {
    checks.push({
      id: 'incremental-migrate-dry-run',
      command: ['node', 'local_scripts/m7-incremental-migrate.mjs'],
      env: { M7_DRY_RUN: '1' },
    })
  }

  if (parseBooleanEnv(process.env.M7_GATE_RUN_DB_RECONCILE, true)) {
    checks.push({
      id: 'db-reconcile',
      command: ['node', 'local_scripts/m7-reconcile-verify.mjs'],
      env: {},
    })
  }

  if (parseBooleanEnv(process.env.M7_GATE_RUN_DUAL_READ, true)) {
    checks.push({
      id: 'dual-read-sampling',
      command: ['node', 'local_scripts/m7-dual-read-verify.mjs'],
      env: {},
    })
  }

  if (parseBooleanEnv(process.env.M7_GATE_RUN_STORAGE_RECONCILE, true)) {
    checks.push({
      id: 'storage-reconcile',
      command: ['node', 'local_scripts/m7-storage-reconcile-verify.mjs'],
      env: {},
    })
  }

  if (parseBooleanEnv(process.env.M7_GATE_RUN_LAG_VERIFY, true)) {
    checks.push({
      id: 'lag-verify',
      command: ['node', 'local_scripts/m7-lag-verify.mjs'],
      env: {},
    })
  }

  await mkdir(reportDir, { recursive: true })

  const startedAt = performance.now()
  const results = []
  for (const check of checks) {
    const result = await runCheck(check)
    results.push(result)

    await writeFile(
      path.join(reportDir, `${result.id}.stdout.log`),
      result.stdout,
      'utf8'
    )
    await writeFile(
      path.join(reportDir, `${result.id}.stderr.log`),
      result.stderr,
      'utf8'
    )
    await writeFile(
      path.join(reportDir, `${result.id}.json`),
      JSON.stringify(result.payload || { ok: false, parseError: true }, null, 2),
      'utf8'
    )
  }

  const summary = {
    ok: results.every(result => result.ok),
    timestamp: new Date().toISOString(),
    reportDir,
    totalDurationMs: Number((performance.now() - startedAt).toFixed(2)),
    checks: results.map(result => ({
      id: result.id,
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    })),
  }

  await writeFile(
    path.join(reportDir, 'summary.json'),
    JSON.stringify(summary, null, 2),
    'utf8'
  )
  await writeFile(
    path.join(reportDir, 'summary.md'),
    renderSummaryMarkdown(summary),
    'utf8'
  )

  console.log(JSON.stringify(summary, null, 2))
  if (!summary.ok) {
    process.exitCode = 1
  }
}

run().catch(error => {
  console.error(
    `[m7-gate-verify] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
