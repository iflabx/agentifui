#!/usr/bin/env node
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { fileURLToPath } from 'node:url'
import { parseBooleanEnv, parsePositiveInt } from './m7-shared.mjs'
import {
  ensureDir,
  formatStageLabel,
  nowTimestamp,
  parsePercentage,
  resolveDefaultObserveMinutes,
  runShellCommand,
  writeJson,
  writeText,
} from './m8-shared.mjs'

function resolveBoolean(overrideValue, envValue, fallbackValue) {
  if (typeof overrideValue === 'boolean') {
    return overrideValue
  }
  return parseBooleanEnv(envValue, fallbackValue)
}

function resolveString(overrideValue, envValue, fallbackValue = '') {
  if (typeof overrideValue === 'string') {
    return overrideValue.trim()
  }
  return envValue?.trim() || fallbackValue
}

function buildSkippedStep(id, reason, command = '') {
  return {
    id,
    command,
    ok: true,
    skipped: true,
    reason,
    exitCode: 0,
    durationMs: 0,
    payload: null,
  }
}

function buildFailedStep(id, reason, command = '') {
  return {
    id,
    command,
    ok: false,
    skipped: false,
    reason,
    exitCode: -1,
    durationMs: 0,
    payload: null,
    stdout: '',
    stderr: reason,
  }
}

function renderSummaryMarkdown(summary) {
  const lines = []
  lines.push(`# M8 Stage Summary (${summary.stage.label})`)
  lines.push('')
  lines.push(`- Stage: ${summary.stage.label}`)
  lines.push(`- Observe Minutes: ${summary.stage.observeMinutes}`)
  lines.push(`- Dry Run: ${summary.config.dryRun ? 'yes' : 'no'}`)
  lines.push(`- Outcome: ${summary.stageOutcome}`)
  lines.push(`- Rollback Required: ${summary.rollbackRequired ? 'yes' : 'no'}`)
  lines.push(`- Overall: ${summary.ok ? 'PASS' : 'FAIL'}`)
  lines.push(`- Stage Dir: ${summary.stageDir}`)
  lines.push('')
  lines.push('| Step | Status | Duration(ms) | Exit |')
  lines.push('| --- | --- | ---: | ---: |')
  for (const step of summary.steps) {
    const status = step.skipped
      ? `SKIP (${step.reason || 'n/a'})`
      : step.ok
        ? 'PASS'
        : 'FAIL'
    lines.push(
      `| ${step.id} | ${status} | ${Number(step.durationMs || 0).toFixed(2)} | ${step.exitCode ?? ''} |`
    )
  }
  lines.push('')
  if (summary.rollbackReasons.length > 0) {
    lines.push('## Rollback Reasons')
    lines.push('')
    for (const reason of summary.rollbackReasons) {
      lines.push(`- ${reason}`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

async function persistStepArtifacts(stageDir, step) {
  if (step.skipped) {
    return
  }
  const baseName = step.id.replaceAll('/', '-')
  await writeText(path.join(stageDir, `${baseName}.stdout.log`), step.stdout || '')
  await writeText(path.join(stageDir, `${baseName}.stderr.log`), step.stderr || '')
  await writeJson(
    path.join(stageDir, `${baseName}.json`),
    step.payload || { ok: step.ok, parseError: true }
  )
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function runStage(overrides = {}) {
  const stagePercent = parsePercentage(
    overrides.stagePercent ?? process.env.M8_STAGE_PERCENT,
    5
  )
  const observeMinutes = parsePositiveInt(
    overrides.observeMinutes ?? process.env.M8_STAGE_OBSERVE_MINUTES,
    resolveDefaultObserveMinutes(stagePercent)
  )
  const stageLabel = resolveString(
    overrides.stageName,
    process.env.M8_STAGE_NAME,
    formatStageLabel(stagePercent)
  )

  const reportRoot = resolveString(
    overrides.reportRoot,
    process.env.M8_REPORT_DIR,
    path.join(process.cwd(), 'artifacts', 'm8', nowTimestamp())
  )

  const stageSlug = resolveString(
    overrides.stageSlug,
    process.env.M8_STAGE_SLUG,
    `stage-${String(stagePercent).padStart(3, '0')}`
  )
  const stageDir = path.join(reportRoot, stageSlug)

  const dryRun = resolveBoolean(overrides.dryRun, process.env.M8_DRY_RUN, true)
  const enforceWait = resolveBoolean(
    overrides.enforceWait,
    process.env.M8_ENFORCE_WAIT,
    false
  )
  const requireSwitchCommand = resolveBoolean(
    overrides.requireSwitchCommand,
    process.env.M8_REQUIRE_SWITCH_COMMAND,
    true
  )
  const requireVerifyTrafficCommand = resolveBoolean(
    overrides.requireVerifyTrafficCommand,
    process.env.M8_REQUIRE_VERIFY_TRAFFIC_COMMAND,
    true
  )
  const requireSmoke = resolveBoolean(
    overrides.requireSmoke,
    process.env.M8_REQUIRE_SMOKE,
    true
  )
  const requireReconcile = resolveBoolean(
    overrides.requireReconcile,
    process.env.M8_REQUIRE_RECONCILE,
    true
  )
  const requireRollbackCommand = resolveBoolean(
    overrides.requireRollbackCommand,
    process.env.M8_REQUIRE_ROLLBACK_COMMAND,
    true
  )
  const forceRollback = resolveBoolean(
    overrides.forceRollback,
    process.env.M8_FORCE_ROLLBACK,
    false
  )
  const expectRollback = resolveBoolean(
    overrides.expectRollback,
    process.env.M8_EXPECT_ROLLBACK,
    false
  )

  const switchCommand = resolveString(
    overrides.switchCommand,
    process.env.M8_SWITCH_TRAFFIC_COMMAND
  )
  const smokeCommand = resolveString(
    overrides.smokeCommand,
    process.env.M8_SMOKE_COMMAND,
    'bash local_scripts/m8-smoke-verify.sh'
  )
  const reconcileCommand = resolveString(
    overrides.reconcileCommand,
    process.env.M8_RECONCILE_COMMAND
  )
  const metricsCommand = resolveString(
    overrides.metricsCommand,
    process.env.M8_METRICS_VERIFY_COMMAND,
    'node local_scripts/m8-metrics-verify.mjs'
  )
  const rollbackCommand = resolveString(
    overrides.rollbackCommand,
    process.env.M8_ROLLBACK_COMMAND
  )
  const verifyTrafficCommand = resolveString(
    overrides.verifyTrafficCommand,
    process.env.M8_VERIFY_TRAFFIC_COMMAND
  )
  const allowDryRunPass = resolveBoolean(
    overrides.allowDryRunPass,
    process.env.M8_ALLOW_DRY_RUN_PASS,
    false
  )

  const sharedEnv = {
    M8_TARGET_PERCENT: String(stagePercent),
    M8_STAGE_PERCENT: String(stagePercent),
    M8_STAGE_NAME: stageLabel,
    M8_STAGE_OBSERVE_MINUTES: String(observeMinutes),
    M8_REPORT_DIR: reportRoot,
  }

  await ensureDir(reportRoot)
  await ensureDir(stageDir)

  const startedAt = performance.now()
  const steps = []
  const rollbackReasons = []

  let switchStep
  if (switchCommand) {
    if (dryRun) {
      switchStep = buildSkippedStep(
        'switch-traffic',
        'dry-run',
        switchCommand
      )
    } else {
      switchStep = await runShellCommand({
        id: 'switch-traffic',
        command: switchCommand,
        env: sharedEnv,
      })
    }
  } else if (requireSwitchCommand) {
    switchStep = buildFailedStep(
      'switch-traffic',
      'missing M8_SWITCH_TRAFFIC_COMMAND'
    )
  } else {
    switchStep = buildSkippedStep(
      'switch-traffic',
      'switch command not configured'
    )
  }
  steps.push(switchStep)
  await persistStepArtifacts(stageDir, switchStep)

  let verifyTrafficStep
  if (verifyTrafficCommand) {
    if (dryRun) {
      verifyTrafficStep = buildSkippedStep(
        'verify-traffic-weight',
        'dry-run',
        verifyTrafficCommand
      )
    } else {
      verifyTrafficStep = await runShellCommand({
        id: 'verify-traffic-weight',
        command: verifyTrafficCommand,
        env: sharedEnv,
      })
    }
  } else if (requireVerifyTrafficCommand) {
    verifyTrafficStep = buildFailedStep(
      'verify-traffic-weight',
      'missing M8_VERIFY_TRAFFIC_COMMAND'
    )
  } else {
    verifyTrafficStep = buildSkippedStep(
      'verify-traffic-weight',
      'traffic verify command not configured'
    )
  }
  steps.push(verifyTrafficStep)
  await persistStepArtifacts(stageDir, verifyTrafficStep)

  let waitStep
  if (enforceWait && !dryRun && switchStep.ok && verifyTrafficStep.ok) {
    const waitStartedAt = performance.now()
    const waitMs = observeMinutes * 60 * 1000
    await sleep(waitMs)
    waitStep = {
      id: 'observe-window',
      command: '',
      ok: true,
      skipped: false,
      reason: null,
      exitCode: 0,
      durationMs: Number((performance.now() - waitStartedAt).toFixed(2)),
      payload: {
        observeMinutes,
        waitedMs: waitMs,
      },
      stdout: '',
      stderr: '',
    }
  } else {
    let reason = 'enforce wait disabled'
    if (enforceWait && dryRun) {
      reason = 'dry-run'
    } else if (enforceWait && (!switchStep.ok || !verifyTrafficStep.ok)) {
      reason = 'pre-check failed'
    }
    waitStep = buildSkippedStep('observe-window', reason)
  }
  steps.push(waitStep)
  await persistStepArtifacts(stageDir, waitStep)

  const prechecksReadyForDeepValidation = switchStep.ok && verifyTrafficStep.ok

  let smokeStep
  let reconcileStep
  let metricsStep
  if (!prechecksReadyForDeepValidation) {
    smokeStep = buildSkippedStep('smoke-check', 'pre-check failed')
    reconcileStep = buildSkippedStep('sample-reconcile', 'pre-check failed')
    metricsStep = buildSkippedStep('metrics-check', 'pre-check failed')
  } else {
    if (smokeCommand) {
      smokeStep = await runShellCommand({
        id: 'smoke-check',
        command: smokeCommand,
        env: sharedEnv,
      })
    } else if (requireSmoke) {
      smokeStep = buildFailedStep('smoke-check', 'missing M8_SMOKE_COMMAND')
    } else {
      smokeStep = buildSkippedStep(
        'smoke-check',
        'smoke command not configured'
      )
    }

    if (reconcileCommand) {
      reconcileStep = await runShellCommand({
        id: 'sample-reconcile',
        command: reconcileCommand,
        env: sharedEnv,
      })
    } else if (requireReconcile) {
      reconcileStep = buildFailedStep(
        'sample-reconcile',
        'missing M8_RECONCILE_COMMAND'
      )
    } else {
      reconcileStep = buildSkippedStep(
        'sample-reconcile',
        'reconcile command not configured'
      )
    }

    metricsStep = await runShellCommand({
      id: 'metrics-check',
      command: metricsCommand,
      env: sharedEnv,
    })
  }

  steps.push(smokeStep)
  await persistStepArtifacts(stageDir, smokeStep)
  steps.push(reconcileStep)
  await persistStepArtifacts(stageDir, reconcileStep)
  steps.push(metricsStep)
  await persistStepArtifacts(stageDir, metricsStep)

  if (!switchStep.ok) {
    rollbackReasons.push('traffic switch step failed')
  }
  if (!verifyTrafficStep.ok) {
    rollbackReasons.push('traffic verify step failed')
  }
  if (!smokeStep.ok) {
    rollbackReasons.push('smoke check failed')
  }
  if (!reconcileStep.ok) {
    rollbackReasons.push('sample reconcile check failed')
  }
  if (!metricsStep.ok) {
    rollbackReasons.push('metrics check failed')
  }

  const metricsRollbackTriggered = Boolean(metricsStep.payload?.checks?.rollbackRequired)
  if (metricsRollbackTriggered) {
    rollbackReasons.push('metrics rollback threshold triggered')
  }
  if (forceRollback) {
    rollbackReasons.push('forced rollback drill')
  }

  const rollbackRequired = rollbackReasons.length > 0
  let rollbackStep
  if (!rollbackRequired) {
    rollbackStep = buildSkippedStep(
      'rollback-execute',
      'rollback not required'
    )
  } else if (rollbackCommand) {
    if (dryRun) {
      rollbackStep = buildSkippedStep(
        'rollback-execute',
        'dry-run',
        rollbackCommand
      )
    } else {
      rollbackStep = await runShellCommand({
        id: 'rollback-execute',
        command: rollbackCommand,
        env: sharedEnv,
      })
    }
  } else if (requireRollbackCommand) {
    rollbackStep = buildFailedStep(
      'rollback-execute',
      'missing M8_ROLLBACK_COMMAND'
    )
  } else {
    rollbackStep = buildSkippedStep(
      'rollback-execute',
      'rollback command not configured'
    )
  }
  steps.push(rollbackStep)
  await persistStepArtifacts(stageDir, rollbackStep)

  const stagePassedWithoutRollback =
    !rollbackRequired &&
    switchStep.ok &&
    smokeStep.ok &&
    reconcileStep.ok &&
    metricsStep.ok

  const rollbackValidationPassed =
    rollbackRequired &&
    ((rollbackStep.ok && !rollbackStep.skipped) ||
      (dryRun && allowDryRunPass && rollbackStep.ok && rollbackStep.skipped))

  let ok = expectRollback ? rollbackValidationPassed : stagePassedWithoutRollback
  let stageOutcome = 'progress'
  if (expectRollback) {
    stageOutcome = ok ? 'rollback-validated' : 'rollback-drill-failed'
  } else if (rollbackRequired) {
    stageOutcome = 'rollback-required'
  } else if (!ok) {
    stageOutcome = 'failed-checks'
  }
  if (dryRun && !allowDryRunPass) {
    ok = false
    stageOutcome = 'dry-run-not-allowed'
  }

  const summary = {
    ok,
    timestamp: new Date().toISOString(),
    stage: {
      percent: stagePercent,
      label: stageLabel,
      observeMinutes,
    },
    stageDir,
    stageOutcome,
    rollbackRequired,
    rollbackReasons,
    config: {
      dryRun,
      enforceWait,
      requireSwitchCommand,
      requireVerifyTrafficCommand,
      requireSmoke,
      requireReconcile,
      requireRollbackCommand,
      forceRollback,
      expectRollback,
      allowDryRunPass,
      commands: {
        switchCommand: switchCommand || null,
        verifyTrafficCommand: verifyTrafficCommand || null,
        smokeCommand: smokeCommand || null,
        reconcileCommand: reconcileCommand || null,
        metricsCommand,
        rollbackCommand: rollbackCommand || null,
      },
    },
    steps: steps.map(step => ({
      id: step.id,
      ok: step.ok,
      skipped: Boolean(step.skipped),
      reason: step.reason || null,
      command: step.command || null,
      exitCode: step.exitCode ?? null,
      durationMs: Number(step.durationMs || 0),
    })),
    totalDurationMs: Number((performance.now() - startedAt).toFixed(2)),
  }

  await writeJson(path.join(stageDir, 'summary.json'), summary)
  await writeText(path.join(stageDir, 'summary.md'), renderSummaryMarkdown(summary))

  return summary
}

async function runCli() {
  const summary = await runStage()
  console.log(JSON.stringify(summary, null, 2))
  if (!summary.ok) {
    process.exitCode = 1
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (entryPath === fileURLToPath(import.meta.url)) {
  runCli().catch(error => {
    console.error(
      `[m8-rollout-stage] ${error instanceof Error ? error.message : String(error)}`
    )
    process.exitCode = 1
  })
}
