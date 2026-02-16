#!/usr/bin/env node
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { parseBooleanEnv } from './m7-shared.mjs'
import {
  ensureDir,
  nowTimestamp,
  runShellCommand,
  writeJson,
  writeText,
} from './m8-shared.mjs'

function renderSummaryMarkdown(summary) {
  const lines = []
  lines.push('# M8 Gate Summary')
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
  const gateTimestamp = nowTimestamp()
  const reportDir =
    process.env.M8_GATE_REPORT_DIR?.trim() ||
    path.join(process.cwd(), 'artifacts', 'm8', 'gate', gateTimestamp)
  await ensureDir(reportDir)

  const runRollout = parseBooleanEnv(process.env.M8_GATE_RUN_ROLLOUT, true)
  const runRollbackDrill = parseBooleanEnv(
    process.env.M8_GATE_RUN_ROLLBACK_DRILL,
    true
  )

  const checks = []
  if (runRollout) {
    checks.push({
      id: 'rollout-run',
      command: 'node scripts/m8-rollout-run.mjs',
      env: {
        M8_REPORT_DIR: path.join(reportDir, 'rollout'),
        M8_DRY_RUN: process.env.M8_GATE_ROLLOUT_DRY_RUN || process.env.M8_DRY_RUN || '1',
        M8_STOP_AFTER_PERCENT: process.env.M8_GATE_ROLLOUT_STOP_AFTER_PERCENT || '',
      },
    })
  }

  if (runRollbackDrill) {
    checks.push({
      id: 'rollback-drill',
      command: 'node scripts/m8-rollback-drill.mjs',
      env: {
        M8_REPORT_DIR: path.join(reportDir, 'rollback-drill'),
        M8_DRY_RUN:
          process.env.M8_GATE_ROLLBACK_DRY_RUN ||
          process.env.M8_DRY_RUN ||
          '1',
      },
    })
  }

  const startedAt = performance.now()
  const checkResults = []

  for (const check of checks) {
    const result = await runShellCommand({
      id: check.id,
      command: check.command,
      env: check.env,
      printOutput: true,
    })
    checkResults.push(result)

    await writeText(
      path.join(reportDir, `${check.id}.stdout.log`),
      result.stdout || ''
    )
    await writeText(
      path.join(reportDir, `${check.id}.stderr.log`),
      result.stderr || ''
    )
    await writeJson(
      path.join(reportDir, `${check.id}.json`),
      result.payload || {
        ok: false,
        parseError: true,
      }
    )
  }

  const summary = {
    ok: checkResults.every(result => result.ok),
    timestamp: new Date().toISOString(),
    reportDir,
    totalDurationMs: Number((performance.now() - startedAt).toFixed(2)),
    checks: checkResults.map(result => ({
      id: result.id,
      ok: result.ok,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    })),
  }

  await writeJson(path.join(reportDir, 'summary.json'), summary)
  await writeText(path.join(reportDir, 'summary.md'), renderSummaryMarkdown(summary))

  console.log(JSON.stringify(summary, null, 2))
  if (!summary.ok) {
    process.exitCode = 1
  }
}

run().catch(error => {
  console.error(
    `[m8-gate-verify] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
