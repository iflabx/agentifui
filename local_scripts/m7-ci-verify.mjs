#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const scriptChecks = [
  ['node', ['--check', 'local_scripts/m7-shared.mjs']],
  ['node', ['--check', 'local_scripts/m7-s3-bootstrap.mjs']],
  ['node', ['--check', 'local_scripts/m7-data-migrate.mjs']],
  ['node', ['--check', 'local_scripts/m7-incremental-migrate.mjs']],
  ['node', ['--check', 'local_scripts/m7-reconcile-verify.mjs']],
  ['node', ['--check', 'local_scripts/m7-dual-read-verify.mjs']],
  ['node', ['--check', 'local_scripts/m7-storage-reconcile-verify.mjs']],
  ['node', ['--check', 'local_scripts/m7-lag-verify.mjs']],
  ['node', ['--check', 'local_scripts/m7-gate-verify.mjs']],
  ['node', ['--check', 'local_scripts/m7-batch-apply.mjs']],
  ['node', ['--check', 'local_scripts/m7-batch-rollback.mjs']],
  ['node', ['--check', 'local_scripts/m7-alert-notify.mjs']],
  ['bash', ['-n', 'local_scripts/m7-ci-runtime-verify.sh']],
  ['bash', ['-n', 'local_scripts/m7-gate-verify.sh']],
]

function parseBoolean(value, fallbackValue) {
  if (!value) {
    return fallbackValue
  }

  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }
  return fallbackValue
}

async function runCommand(command, args) {
  const result = await execFileAsync(command, args, {
    cwd: process.cwd(),
    env: process.env,
  })
  return {
    command: [command, ...args].join(' '),
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  }
}

async function run() {
  const commandResults = []
  for (const [command, args] of scriptChecks) {
    await runCommand(command, args)
    commandResults.push({
      command: [command, ...args].join(' '),
      ok: true,
    })
  }

  const packageJson = JSON.parse(await readFile('package.json', 'utf8'))
  const scripts = packageJson.scripts || {}
  const forbiddenPublicScripts = Object.keys(scripts).filter(
    name => name.startsWith('m7:') || name.startsWith('m8:')
  )

  const checks = {
    syntaxChecksPassed: true,
    publicPackageScriptsRemoved: forbiddenPublicScripts.length === 0,
  }

  const runtimeSmokeEnabled = parseBoolean(
    process.env.M7_CI_RUNTIME_SMOKE,
    false
  )
  let runtimeSmoke = {
    enabled: runtimeSmokeEnabled,
    ok: true,
    command: null,
  }
  if (runtimeSmokeEnabled) {
    const runtimeCommand = ['bash', 'local_scripts/m7-ci-runtime-verify.sh']
    await runCommand(runtimeCommand[0], runtimeCommand.slice(1))
    runtimeSmoke = {
      enabled: true,
      ok: true,
      command: runtimeCommand.join(' '),
    }
  }

  const payload = {
    ok: Object.values(checks).every(Boolean) && runtimeSmoke.ok,
    checks,
    syntaxCommands: commandResults,
    forbiddenPublicScripts,
    runtimeSmoke,
  }

  console.log(JSON.stringify(payload, null, 2))
  if (!payload.ok) {
    process.exitCode = 1
  }
}

run().catch(error => {
  console.error(
    `[m7-ci-verify] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
