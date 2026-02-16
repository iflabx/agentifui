#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  parseBooleanEnv,
  parsePositiveInt,
  parseCommaList,
} from './m7-shared.mjs'
import { runShellCommand } from './m8-shared.mjs'

function parseNumber(value, fallbackValue) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallbackValue
}

function pickNumber(payload, keys, fallbackValue = 0) {
  for (const key of keys) {
    if (key in payload) {
      const parsed = Number(payload[key])
      if (Number.isFinite(parsed)) {
        return parsed
      }
    }
  }
  return fallbackValue
}

function normalizeMetrics(rawPayload) {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {}
  const root = payload.metrics && typeof payload.metrics === 'object' ? payload.metrics : payload

  return {
    http5xxRatePct: pickNumber(root, [
      'http5xxRatePct',
      'fiveXXRatePct',
      'errorRate5xxPct',
      'http_5xx_rate_pct',
    ]),
    http5xxSustainedMinutes: pickNumber(root, [
      'http5xxSustainedMinutes',
      'fiveXXSustainedMinutes',
      'errorRate5xxSustainedMinutes',
      'http_5xx_sustained_minutes',
    ]),
    realtimeP95Ms: pickNumber(root, [
      'realtimeP95Ms',
      'realtimeP95LatencyMs',
      'realtime_p95_ms',
    ]),
    realtimeSustainedMinutes: pickNumber(root, [
      'realtimeSustainedMinutes',
      'realtimeLatencySustainedMinutes',
      'realtime_sustained_minutes',
    ]),
    loginFailureRatePct: pickNumber(root, [
      'loginFailureRatePct',
      'authFailureRatePct',
      'login_failure_rate_pct',
    ]),
    loginFailureSustainedMinutes: pickNumber(root, [
      'loginFailureSustainedMinutes',
      'authFailureSustainedMinutes',
      'login_failure_sustained_minutes',
    ]),
    unexplainedReconcileDiffCount: pickNumber(root, [
      'unexplainedReconcileDiffCount',
      'reconcileDiffCount',
      'unexplained_reconcile_diff_count',
    ]),
    authBypassEventCount: pickNumber(root, [
      'authBypassEventCount',
      'authBypassEvents',
      'auth_bypass_event_count',
    ]),
  }
}

async function loadMetricsFromPath(filePath) {
  const content = await readFile(filePath, 'utf8')
  return JSON.parse(content)
}

async function loadMetricsPayload() {
  const strictMode = parseBooleanEnv(process.env.M8_METRICS_STRICT, false)
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

  if (strictMode) {
    throw new Error(
      'metrics input missing in strict mode: set M8_METRICS_JSON or M8_METRICS_PATH or M8_METRICS_COMMAND'
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
  ]

  return {
    checks,
    rollbackRequired: checks.some(check => check.triggered),
  }
}

async function run() {
  const payload = await loadMetricsPayload()
  const metrics = normalizeMetrics(payload.raw)
  const evaluated = evaluateMetrics(metrics)
  const requiredSignals = parseCommaList(
    process.env.M8_REQUIRED_METRIC_SIGNALS,
    [
      'http5xxRatePct',
      'http5xxSustainedMinutes',
      'realtimeP95Ms',
      'realtimeSustainedMinutes',
      'loginFailureRatePct',
      'loginFailureSustainedMinutes',
      'unexplainedReconcileDiffCount',
      'authBypassEventCount',
    ]
  )

  const missingSignals = requiredSignals.filter(
    key => !(key in metrics) || Number.isNaN(Number(metrics[key]))
  )
  const strictSignals = parseBooleanEnv(process.env.M8_METRICS_REQUIRE_ALL_SIGNALS, false)
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
