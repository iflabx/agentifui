#!/usr/bin/env node
import path from 'node:path'
import { parseBooleanEnv, parsePositiveInt } from './m7-shared.mjs'
import { ensureDir, nowTimestamp, writeJson, writeText } from './m8-shared.mjs'
import { runStage } from './m8-rollout-stage.mjs'

function renderSummaryMarkdown(summary) {
  const lines = []
  lines.push('# M8 Rollback Drill Summary')
  lines.push('')
  lines.push(`- Timestamp: ${summary.timestamp}`)
  lines.push(`- Report Dir: ${summary.reportDir}`)
  lines.push(`- Overall: ${summary.ok ? 'PASS' : 'FAIL'}`)
  lines.push(`- Stage: ${summary.stage.stage.label}`)
  lines.push(`- Stage Dir: ${summary.stage.stageDir}`)
  lines.push('')
  lines.push('## Rollback Reasons')
  lines.push('')
  for (const reason of summary.stage.rollbackReasons) {
    lines.push(`- ${reason}`)
  }
  lines.push('')
  return lines.join('\n')
}

async function run() {
  const drillPercent = parsePositiveInt(process.env.M8_DRILL_PERCENT, 20)
  const drillObserveMinutes = parsePositiveInt(
    process.env.M8_DRILL_OBSERVE_MINUTES,
    5
  )
  const allowDryRunPass = parseBooleanEnv(
    process.env.M8_ALLOW_DRY_RUN_PASS,
    false
  )
  const reportDir =
    process.env.M8_REPORT_DIR?.trim() ||
    path.join(process.cwd(), 'artifacts', 'm8', 'rollback-drill', nowTimestamp())
  await ensureDir(reportDir)

  const stageSummary = await runStage({
    stagePercent: drillPercent,
    observeMinutes: drillObserveMinutes,
    stageName: `${drillPercent}% rollback-drill`,
    stageSlug: `rollback-drill-${String(drillPercent).padStart(3, '0')}`,
    reportRoot: reportDir,
    forceRollback: true,
    expectRollback: true,
    requireRollbackCommand: true,
    allowDryRunPass,
  })

  const summary = {
    ok: stageSummary.ok,
    timestamp: new Date().toISOString(),
    reportDir,
    stage: {
      ok: stageSummary.ok,
      stage: stageSummary.stage,
      stageDir: stageSummary.stageDir,
      stageOutcome: stageSummary.stageOutcome,
      rollbackRequired: stageSummary.rollbackRequired,
      rollbackReasons: stageSummary.rollbackReasons,
      totalDurationMs: stageSummary.totalDurationMs,
    },
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
    `[m8-rollback-drill] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
