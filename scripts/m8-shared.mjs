#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

import { parseBooleanEnv, parsePositiveInt } from './m7-shared.mjs';

export const DEFAULT_ROLLOUT_STAGES = [
  { percent: 5, observeMinutes: 30 },
  { percent: 20, observeMinutes: 60 },
  { percent: 50, observeMinutes: 120 },
  { percent: 100, observeMinutes: 1440 },
];

const DEFAULT_OBSERVE_MINUTES_BY_PERCENT = new Map(
  DEFAULT_ROLLOUT_STAGES.map(stage => [stage.percent, stage.observeMinutes])
);

export function nowTimestamp() {
  return new Date()
    .toISOString()
    .replaceAll(':', '')
    .replaceAll('-', '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function resolveDefaultObserveMinutes(percent) {
  return DEFAULT_OBSERVE_MINUTES_BY_PERCENT.get(percent) || 30;
}

export function formatStageLabel(percent) {
  return `${percent}%`;
}

export function parsePercentage(value, fallbackValue) {
  const parsed = parsePositiveInt(value, fallbackValue);
  if (!Number.isFinite(parsed) || parsed < 1 || parsed > 100) {
    return fallbackValue;
  }
  return parsed;
}

function parseStageToken(token) {
  const normalized = token.trim();
  if (!normalized) {
    return null;
  }

  const pairMatch = normalized.match(/^(\d{1,3})\s*[:@]\s*(\d+)$/);
  if (pairMatch) {
    const percent = parsePositiveInt(pairMatch[1], 0);
    const observeMinutes = parsePositiveInt(pairMatch[2], 0);
    if (percent < 1 || percent > 100 || observeMinutes <= 0) {
      throw new Error(`invalid rollout stage token: ${token}`);
    }
    return { percent, observeMinutes };
  }

  const percentOnly = parsePositiveInt(normalized, 0);
  if (percentOnly < 1 || percentOnly > 100) {
    throw new Error(`invalid rollout stage token: ${token}`);
  }
  return {
    percent: percentOnly,
    observeMinutes: resolveDefaultObserveMinutes(percentOnly),
  };
}

export function parseRolloutStages(rawValue) {
  const raw = rawValue?.trim();
  if (!raw) {
    return DEFAULT_ROLLOUT_STAGES.map(stage => ({ ...stage }));
  }

  const stages = raw
    .split(',')
    .map(token => parseStageToken(token))
    .filter(Boolean);

  if (stages.length === 0) {
    throw new Error('M8_ROLLOUT_STAGES is empty after parsing');
  }

  const deduplicated = [];
  const seen = new Set();
  for (const stage of stages) {
    if (seen.has(stage.percent)) {
      continue;
    }
    seen.add(stage.percent);
    deduplicated.push(stage);
  }

  return deduplicated;
}

export function extractTrailingJson(text) {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const end = trimmed.lastIndexOf('}');
  if (end < 0) {
    return null;
  }

  for (
    let start = trimmed.lastIndexOf('{', end);
    start >= 0;
    start = trimmed.lastIndexOf('{', start - 1)
  ) {
    const candidate = trimmed.slice(start, end + 1);
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue scanning backward.
    }
  }

  return null;
}

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
  return dirPath;
}

export async function writeJson(filePath, payload) {
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

export async function writeText(filePath, payload) {
  await writeFile(filePath, payload, 'utf8');
}

export async function runShellCommand({
  id,
  command,
  env = {},
  cwd = process.cwd(),
  printOutput = true,
}) {
  if (!command?.trim()) {
    return {
      id,
      command: '',
      ok: false,
      exitCode: -1,
      durationMs: 0,
      stdout: '',
      stderr: 'empty command',
      payload: null,
    };
  }

  const startedAt = performance.now();
  return new Promise(resolve => {
    const child = spawn('bash', ['-lc', command], {
      cwd,
      env: {
        ...process.env,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const finalize = ({ exitCode, signal = null, error = null }) => {
      if (settled) {
        return;
      }
      settled = true;
      const payload = extractTrailingJson(stdout);
      const ok =
        exitCode === 0 &&
        (payload === null ||
          typeof payload.ok !== 'boolean' ||
          payload.ok === true);

      resolve({
        id,
        command,
        ok: Boolean(ok),
        exitCode,
        signal,
        error: error
          ? error instanceof Error
            ? error.message
            : String(error)
          : null,
        durationMs: Number((performance.now() - startedAt).toFixed(2)),
        stdout,
        stderr,
        payload,
      });
    };

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      stdout += text;
      if (printOutput) {
        process.stdout.write(text);
      }
    });

    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      stderr += text;
      if (printOutput) {
        process.stderr.write(text);
      }
    });

    child.on('error', error => {
      finalize({ exitCode: -1, error });
    });

    child.on('close', (code, signal) => {
      finalize({
        exitCode: Number.isInteger(code) ? code : -1,
        signal,
      });
    });
  });
}

export function resolveM8ReportRoot() {
  return (
    process.env.M8_REPORT_DIR?.trim() ||
    path.join(process.cwd(), 'artifacts', 'm8', nowTimestamp())
  );
}

export function parseRequiredStep(value, fallbackValue) {
  return parseBooleanEnv(value, fallbackValue);
}
