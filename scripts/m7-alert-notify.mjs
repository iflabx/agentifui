#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
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

function buildWebhookPayload(summary, summaryPath) {
  return {
    event: 'm7-gate',
    ok: summary.ok,
    timestamp: summary.timestamp || new Date().toISOString(),
    reportDir: summary.reportDir || null,
    summaryPath,
    checks: summary.checks || [],
    source: 'agentifui',
  }
}

async function sendWebhook(payload) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(
      `webhook responded ${response.status}${body ? `: ${body}` : ''}`
    )
  }
}

async function run() {
  const summaryPath = await resolveLatestSummaryPath()
  const summaryRaw = await readFile(summaryPath, 'utf8')
  const summary = JSON.parse(summaryRaw)
  const payload = buildWebhookPayload(summary, summaryPath)

  const shouldNotify = !summary.ok || notifyOnSuccess
  if (shouldNotify && webhookUrl) {
    await sendWebhook(payload)
  }

  const result = {
    ok: true,
    summaryOk: Boolean(summary.ok),
    notified: Boolean(shouldNotify && webhookUrl),
    notifySkippedReason: shouldNotify
      ? webhookUrl
        ? null
        : 'missing_webhook_url'
      : 'success_notification_disabled',
    payload,
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
