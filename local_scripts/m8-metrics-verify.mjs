#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  parseBooleanEnv,
  parseCommaList,
  parsePositiveInt,
} from './m7-shared.mjs'
import { parsePercentage, runShellCommand } from './m8-shared.mjs'

function parseNumber(value, fallbackValue) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallbackValue
}

function pickMetric(payload, keys, fallbackValue = 0) {
  for (const key of keys) {
    if (!(key in payload)) {
      continue
    }
    const parsed = Number(payload[key])
    if (Number.isFinite(parsed)) {
      return { value: parsed, present: true, sourceKey: key }
    }
  }
  return { value: fallbackValue, present: false, sourceKey: null }
}

function normalizeMetrics(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {}
  const root =
    payload.metrics && typeof payload.metrics === 'object'
      ? payload.metrics
      : payload

  const http5xxRatePct = pickMetric(root, [
    'http5xxRatePct',
    'fiveXXRatePct',
    'errorRate5xxPct',
    'http_5xx_rate_pct',
  ])
  const http5xxSustainedMinutes = pickMetric(root, [
    'http5xxSustainedMinutes',
    'fiveXXSustainedMinutes',
    'errorRate5xxSustainedMinutes',
    'http_5xx_sustained_minutes',
  ])
  const realtimeP95Ms = pickMetric(root, [
    'realtimeP95Ms',
    'realtimeP95LatencyMs',
    'realtime_p95_ms',
  ])
  const realtimeSustainedMinutes = pickMetric(root, [
    'realtimeSustainedMinutes',
    'realtimeLatencySustainedMinutes',
    'realtime_sustained_minutes',
  ])
  const loginFailureRatePct = pickMetric(root, [
    'loginFailureRatePct',
    'authFailureRatePct',
    'login_failure_rate_pct',
  ])
  const loginFailureSustainedMinutes = pickMetric(root, [
    'loginFailureSustainedMinutes',
    'authFailureSustainedMinutes',
    'login_failure_sustained_minutes',
  ])
  const unexplainedReconcileDiffCount = pickMetric(root, [
    'unexplainedReconcileDiffCount',
    'reconcileDiffCount',
    'unexplained_reconcile_diff_count',
  ])
  const authBypassEventCount = pickMetric(root, [
    'authBypassEventCount',
    'authBypassEvents',
    'auth_bypass_event_count',
  ])
  const at100StableMinutes = pickMetric(root, [
    'at100StableMinutes',
    'stableAtCurrentPercentMinutes',
    'stable_minutes_at_current_percent',
  ])

  return {
    metrics: {
      http5xxRatePct: http5xxRatePct.value,
      http5xxSustainedMinutes: http5xxSustainedMinutes.value,
      realtimeP95Ms: realtimeP95Ms.value,
      realtimeSustainedMinutes: realtimeSustainedMinutes.value,
      loginFailureRatePct: loginFailureRatePct.value,
      loginFailureSustainedMinutes: loginFailureSustainedMinutes.value,
      unexplainedReconcileDiffCount: unexplainedReconcileDiffCount.value,
      authBypassEventCount: authBypassEventCount.value,
      at100StableMinutes: at100StableMinutes.value,
    },
    signalPresence: {
      http5xxRatePct: http5xxRatePct.present,
      http5xxSustainedMinutes: http5xxSustainedMinutes.present,
      realtimeP95Ms: realtimeP95Ms.present,
      realtimeSustainedMinutes: realtimeSustainedMinutes.present,
      loginFailureRatePct: loginFailureRatePct.present,
      loginFailureSustainedMinutes: loginFailureSustainedMinutes.present,
      unexplainedReconcileDiffCount: unexplainedReconcileDiffCount.present,
      authBypassEventCount: authBypassEventCount.present,
      at100StableMinutes: at100StableMinutes.present,
    },
  }
}

async function loadMetricsFromPath(filePath) {
  const content = await readFile(filePath, 'utf8')
  return JSON.parse(content)
}

async function loadMetricsPayload() {
  const strictMode = parseBooleanEnv(process.env.M8_METRICS_STRICT, true)
  const allowSynthetic = parseBooleanEnv(
    process.env.M8_ALLOW_SYNTHETIC_METRICS,
    false
  )
  const metricsJsonRaw = process.env.M8_METRICS_JSON?.trim() || ''
  const metricsPath = process.env.M8_METRICS_PATH?.trim() || ''
  const metricsCommand = process.env.M8_METRICS_COMMAND?.trim() || ''

  if (metricsJsonRaw) {
    return {
      source: 'env:M8_METRICS_JSON',
      raw: JSON.parse(metricsJsonRaw),
    }
  }

  if (metricsPath) {
    const resolvedPath = path.resolve(metricsPath)
    return {
      source: `file:${resolvedPath}`,
      raw: await loadMetricsFromPath(resolvedPath),
    }
  }

  if (metricsCommand) {
    const result = await runShellCommand({
      id: 'metrics-command',
      command: metricsCommand,
      printOutput: true,
    })
    if (!result.ok) {
      throw new Error(
        `metrics command failed: ${metricsCommand} (exit=${result.exitCode})`
      )
    }
    if (!result.payload || typeof result.payload !== 'object') {
      throw new Error('metrics command did not output trailing JSON payload')
    }
    return {
      source: `command:${metricsCommand}`,
      raw: result.payload,
      commandResult: {
        exitCode: result.exitCode,
        durationMs: result.durationMs,
      },
    }
  }

  if (strictMode && !allowSynthetic) {
    throw new Error(
      'metrics input missing: set M8_METRICS_JSON or M8_METRICS_PATH or M8_METRICS_COMMAND'
    )
  }

  if (!allowSynthetic) {
    throw new Error(
      'synthetic metrics are disabled; set M8_ALLOW_SYNTHETIC_METRICS=1 to bypass'
    )
  }

  return {
    source: 'synthetic-default',
    raw: {
      http5xxRatePct: 0,
      http5xxSustainedMinutes: 0,
      realtimeP95Ms: 0,
      realtimeSustainedMinutes: 0,
      loginFailureRatePct: 0,
      loginFailureSustainedMinutes: 0,
      unexplainedReconcileDiffCount: 0,
      authBypassEventCount: 0,
      at100StableMinutes: 0,
    },
    synthetic: true,
  }
}

function evaluateMetrics(metrics) {
  const threshold5xxRatePct = parseNumber(
    process.env.M8_THRESHOLD_5XX_RATE_PCT,
    1
  )
  const threshold5xxMinutes = parsePositiveInt(
    process.env.M8_THRESHOLD_5XX_MINUTES,
    5
  )
  const thresholdRealtimeP95Ms = parsePositiveInt(
    process.env.M8_THRESHOLD_REALTIME_P95_MS,
    2000
  )
  const thresholdRealtimeMinutes = parsePositiveInt(
    process.env.M8_THRESHOLD_REALTIME_MINUTES,
    10
  )
  const thresholdLoginFailurePct = parseNumber(
    process.env.M8_THRESHOLD_LOGIN_FAILURE_PCT,
    1
  )
  const thresholdLoginFailureMinutes = parsePositiveInt(
    process.env.M8_THRESHOLD_LOGIN_FAILURE_MINUTES,
    5
  )
  const targetPercent = parsePercentage(process.env.M8_TARGET_PERCENT, 0)
  const require100Stability = parseBooleanEnv(
    process.env.M8_REQUIRE_100_STABILITY,
    true
  )
  const required100StableMinutes = parsePositiveInt(
    process.env.M8_REQUIRED_100_STABILITY_MINUTES,
    1440
  )

  const checks = [
    {
      id: 'http-5xx-rate',
      description: '5xx error rate > 1.0% sustained 5m',
      triggered:
        metrics.http5xxRatePct > threshold5xxRatePct &&
        metrics.http5xxSustainedMinutes >= threshold5xxMinutes,
      observed: {
        ratePct: metrics.http5xxRatePct,
        sustainedMinutes: metrics.http5xxSustainedMinutes,
      },
      threshold: {
        ratePct: threshold5xxRatePct,
        sustainedMinutes: threshold5xxMinutes,
      },
    },
    {
      id: 'realtime-p95-latency',
      description: 'realtime p95 > 2000ms sustained 10m',
      triggered:
        metrics.realtimeP95Ms > thresholdRealtimeP95Ms &&
        metrics.realtimeSustainedMinutes >= thresholdRealtimeMinutes,
      observed: {
        p95Ms: metrics.realtimeP95Ms,
        sustainedMinutes: metrics.realtimeSustainedMinutes,
      },
      threshold: {
        p95Ms: thresholdRealtimeP95Ms,
        sustainedMinutes: thresholdRealtimeMinutes,
      },
    },
    {
      id: 'login-failure-rate',
      description: 'login failure rate > 1.0% sustained 5m',
      triggered:
        metrics.loginFailureRatePct > thresholdLoginFailurePct &&
        metrics.loginFailureSustainedMinutes >= thresholdLoginFailureMinutes,
      observed: {
        ratePct: metrics.loginFailureRatePct,
        sustainedMinutes: metrics.loginFailureSustainedMinutes,
      },
      threshold: {
        ratePct: thresholdLoginFailurePct,
        sustainedMinutes: thresholdLoginFailureMinutes,
      },
    },
    {
      id: 'unexplained-reconcile-diff',
      description: 'unexplained reconcile diff > 0',
      triggered: metrics.unexplainedReconcileDiffCount > 0,
      observed: {
        count: metrics.unexplainedReconcileDiffCount,
      },
      threshold: {
        maxCount: 0,
      },
    },
    {
      id: 'auth-bypass-event',
      description: 'auth bypass event count > 0',
      triggered: metrics.authBypassEventCount > 0,
      observed: {
        count: metrics.authBypassEventCount,
      },
      threshold: {
        maxCount: 0,
      },
    },
    {
      id: '100-percent-stability-window',
      description: '100% stage must stay stable for >= 1440 minutes',
      triggered:
        targetPercent === 100 &&
        require100Stability &&
        metrics.at100StableMinutes < required100StableMinutes,
      observed: {
        targetPercent,
        at100StableMinutes: metrics.at100StableMinutes,
      },
      threshold: {
        targetPercent: 100,
        minStableMinutes: required100StableMinutes,
      },
    },
  ]

  return {
    checks,
    rollbackRequired: checks.some(check => check.triggered),
    config: {
      targetPercent,
      require100Stability,
      required100StableMinutes,
    },
  }
}

async function run() {
  const payload = await loadMetricsPayload()
  const normalized = normalizeMetrics(payload.raw)
  const metrics = normalized.metrics
  const evaluated = evaluateMetrics(metrics)
  const requiredSignals = parseCommaList(process.env.M8_REQUIRED_METRIC_SIGNALS, [
    'http5xxRatePct',
    'http5xxSustainedMinutes',
    'realtimeP95Ms',
    'realtimeSustainedMinutes',
    'loginFailureRatePct',
    'loginFailureSustainedMinutes',
    'unexplainedReconcileDiffCount',
    'authBypassEventCount',
  ])

  if (evaluated.config.targetPercent === 100 && evaluated.config.require100Stability) {
    if (!requiredSignals.includes('at100StableMinutes')) {
      requiredSignals.push('at100StableMinutes')
    }
  }

  const missingSignals = requiredSignals.filter(
    key => normalized.signalPresence[key] !== true
  )
  const strictSignals = parseBooleanEnv(
    process.env.M8_METRICS_REQUIRE_ALL_SIGNALS,
    true
  )
  const signalsComplete = missingSignals.length === 0

  const ok = !evaluated.rollbackRequired && (!strictSignals || signalsComplete)

  const summary = {
    ok,
    source: payload.source,
    synthetic: Boolean(payload.synthetic),
    checks: {
      rollbackRequired: evaluated.rollbackRequired,
      signalsComplete,
    },
    config: {
      strictSignals,
      requiredSignals,
      ...evaluated.config,
    },
    missingSignals,
    metrics,
    triggerChecks: evaluated.checks,
    commandResult: payload.commandResult || null,
  }

  console.log(JSON.stringify(summary, null, 2))
  if (!summary.ok) {
    process.exitCode = 1
  }
}

run().catch(error => {
  console.error(
    `[m8-metrics-verify] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
