#!/usr/bin/env node
import crypto from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { parseBooleanEnv } from './m7-shared.mjs'

const artifactsRoot = path.join(process.cwd(), 'artifacts', 'm7')
const explicitSummaryPath = process.env.M7_ALERT_SUMMARY_PATH?.trim() || null
const webhookUrl = process.env.M7_ALERT_WEBHOOK_URL?.trim() || ''
const notifyOnSuccess = parseBooleanEnv(
  process.env.M7_ALERT_NOTIFY_ON_SUCCESS,
  false
)
const failOnGateFailure = parseBooleanEnv(
  process.env.M7_ALERT_FAIL_ON_GATE_FAILURE,
  true
)
const webhookSecret = process.env.M7_ALERT_WEBHOOK_SECRET?.trim() || ''
const maxRetriesRaw = Number(process.env.M7_ALERT_MAX_RETRIES || 3)
const maxRetries = Number.isFinite(maxRetriesRaw)
  ? Math.max(0, Math.floor(maxRetriesRaw))
  : 3
const retryBaseMsRaw = Number(process.env.M7_ALERT_RETRY_BASE_MS || 500)
const retryBaseMs = Number.isFinite(retryBaseMsRaw)
  ? Math.max(100, Math.floor(retryBaseMsRaw))
  : 500

async function resolveLatestSummaryPath() {
  if (explicitSummaryPath) {
    return explicitSummaryPath
  }

  const entries = await readdir(artifactsRoot, { withFileTypes: true })
  const directories = entries.filter(entry => entry.isDirectory()).map(entry => entry.name)
  directories.sort((a, b) => b.localeCompare(a))
  for (const dirName of directories) {
    const candidate = path.join(artifactsRoot, dirName, 'summary.json')
    try {
      await readFile(candidate, 'utf8')
      return candidate
    } catch {
      // continue scanning older directories
    }
  }

  throw new Error('no summary.json found under artifacts/m7')
}

function buildWebhookPayload(summary, summaryPath, attempt = 1) {
  return {
    event: 'm7-gate',
    ok: summary.ok,
    timestamp: summary.timestamp || new Date().toISOString(),
    reportDir: summary.reportDir || null,
    summaryPath,
    checks: summary.checks || [],
    attempt,
    source: 'agentifui',
  }
}

function signPayload(rawBody) {
  if (!webhookSecret) {
    return null
  }
  const signature = crypto
    .createHmac('sha256', webhookSecret)
    .update(rawBody)
    .digest('hex')
  return `sha256=${signature}`
}

function shouldRetryStatus(status) {
  return status === 429 || status >= 500
}

async function sendWebhook(payload, attempt) {
  const body = JSON.stringify(payload)
  const signature = signPayload(body)
  const headers = {
    'content-type': 'application/json',
    'x-m7-attempt': String(attempt),
  }
  if (signature) {
    headers['x-m7-signature'] = signature
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers,
    body,
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const error = new Error(
      `webhook responded ${response.status}${body ? `: ${body}` : ''}`
    )
    error.retryable = shouldRetryStatus(response.status)
    throw error
  }
}

async function sendWebhookWithRetry(summary, summaryPath) {
  let lastError = null
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const payload = buildWebhookPayload(summary, summaryPath, attempt)
    try {
      await sendWebhook(payload, attempt)
      return {
        sent: true,
        attempts: attempt,
        payload,
      }
    } catch (error) {
      lastError = error
      const retryable = Boolean(error?.retryable)
      const hasNextAttempt = attempt <= maxRetries
      if (!retryable || !hasNextAttempt) {
        throw error
      }
      await sleep(retryBaseMs * attempt)
    }
  }

  throw lastError || new Error('webhook delivery failed')
}

async function run() {
  const summaryPath = await resolveLatestSummaryPath()
  const summaryRaw = await readFile(summaryPath, 'utf8')
  const summary = JSON.parse(summaryRaw)
  const payload = buildWebhookPayload(summary, summaryPath, 1)

  const shouldNotify = !summary.ok || notifyOnSuccess
  let notifyResult = {
    sent: false,
    attempts: 0,
    payload,
  }
  if (shouldNotify && webhookUrl) {
    notifyResult = await sendWebhookWithRetry(summary, summaryPath)
  }

  const result = {
    ok: true,
    summaryOk: Boolean(summary.ok),
    notified: Boolean(shouldNotify && webhookUrl && notifyResult.sent),
    notifySkippedReason: shouldNotify
      ? webhookUrl
        ? null
        : 'missing_webhook_url'
      : 'success_notification_disabled',
    notifyAttempts: notifyResult.attempts,
    webhookSigned: Boolean(webhookSecret),
    payload: notifyResult.payload,
  }

  console.log(JSON.stringify(result, null, 2))
  if (!summary.ok && failOnGateFailure) {
    process.exitCode = 1
  }
}

run().catch(error => {
  console.error(
    `[m7-alert-notify] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
