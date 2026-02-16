#!/usr/bin/env node
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { parsePositiveInt } from './m7-shared.mjs'
import {
  ensureDir,
  nowTimestamp,
  parseRolloutStages,
  writeJson,
  writeText,
} from './m8-shared.mjs'
import { runStage } from './m8-rollout-stage.mjs'

function renderSummaryMarkdown(summary) {
  const lines = []
  lines.push('# M8 Rollout Summary')
  lines.push('')
  lines.push(`- Timestamp: ${summary.timestamp}`)
  lines.push(`- Report Dir: ${summary.reportDir}`)
  lines.push(`- Overall: ${summary.ok ? 'PASS' : 'FAIL'}`)
  lines.push(`- Completed Stages: ${summary.completedStages.length}/${summary.plannedStages.length}`)
  lines.push('')
  lines.push('| Stage | Observe(min) | Status | Outcome | Duration(ms) |')
  lines.push('| --- | ---: | --- | --- | ---: |')
  for (const stage of summary.stageResults) {
    lines.push(
      `| ${stage.stage.label} | ${stage.stage.observeMinutes} | ${stage.ok ? 'PASS' : 'FAIL'} | ${stage.stageOutcome} | ${stage.totalDurationMs} |`
    )
  }
  lines.push('')
  if (summary.failedStage) {
    lines.push('## Failed Stage')
    lines.push('')
    lines.push(`- ${summary.failedStage.stage.label}`)
    lines.push(`- Stage Dir: ${summary.failedStage.stageDir}`)
    lines.push('')
  }
  return lines.join('\n')
}

async function run() {
  const plannedStages = parseRolloutStages(process.env.M8_ROLLOUT_STAGES)
  const stopAfterPercent = parsePositiveInt(process.env.M8_STOP_AFTER_PERCENT, 0)
  const startFromPercent = parsePositiveInt(process.env.M8_START_FROM_PERCENT, 0)

  const reportDir =
    process.env.M8_REPORT_DIR?.trim() ||
    path.join(process.cwd(), 'artifacts', 'm8', nowTimestamp())
  await ensureDir(reportDir)

  const startedAt = performance.now()
  const stageResults = []

  for (const stage of plannedStages) {
    if (startFromPercent > 0 && stage.percent < startFromPercent) {
      continue
    }
    if (stopAfterPercent > 0 && stage.percent > stopAfterPercent) {
      break
    }

    const stageSummary = await runStage({
      stagePercent: stage.percent,
      observeMinutes: stage.observeMinutes,
      reportRoot: reportDir,
      stageSlug: `stage-${String(stage.percent).padStart(3, '0')}`,
      stageName: `${stage.percent}%`,
    })

    stageResults.push(stageSummary)
    if (!stageSummary.ok) {
      break
    }
  }

  const failedStage = stageResults.find(stage => !stage.ok) || null
  const summary = {
    ok: failedStage === null,
    timestamp: new Date().toISOString(),
    reportDir,
    plannedStages,
    completedStages: stageResults.map(stage => stage.stage.percent),
    failedStage,
    stageResults: stageResults.map(stage => ({
      ok: stage.ok,
      stage: stage.stage,
      stageDir: stage.stageDir,
      stageOutcome: stage.stageOutcome,
      rollbackRequired: stage.rollbackRequired,
      rollbackReasons: stage.rollbackReasons,
      totalDurationMs: stage.totalDurationMs,
    })),
    totalDurationMs: Number((performance.now() - startedAt).toFixed(2)),
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
    `[m8-rollout-run] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
