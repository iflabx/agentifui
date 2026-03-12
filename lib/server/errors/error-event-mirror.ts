import { existsSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import 'server-only';

export interface ErrorEventMirrorInput {
  runtime: 'next' | 'fastify';
  fingerprint: string;
  code: string;
  source: string;
  severity: string;
  retryable: boolean;
  userMessage: string;
  developerMessage?: string | null;
  httpStatus?: number | null;
  method?: string | null;
  route?: string | null;
  requestId: string;
  traceId?: string | null;
  actorUserId?: string | null;
  contextJson: Record<string, unknown>;
}

function findWorkspaceRoot(): string {
  const candidates = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
    path.resolve(process.cwd(), '..', '..'),
  ];

  for (const candidate of candidates) {
    if (
      existsSync(path.join(candidate, 'package.json')) &&
      existsSync(path.join(candidate, 'app'))
    ) {
      return candidate;
    }
  }

  return process.cwd();
}

function getMirrorPath(): string {
  return path.join(findWorkspaceRoot(), 'pm2-logs', 'error-events.jsonl');
}

export async function appendErrorEventMirror(
  input: ErrorEventMirrorInput
): Promise<void> {
  try {
    const targetPath = getMirrorPath();
    await mkdir(path.dirname(targetPath), { recursive: true });

    const entry = {
      recorded_at: new Date().toISOString(),
      hostname: os.hostname(),
      pid: process.pid,
      runtime: input.runtime,
      fingerprint: input.fingerprint,
      code: input.code,
      source: input.source,
      severity: input.severity,
      retryable: input.retryable,
      user_message: input.userMessage,
      developer_message: input.developerMessage || null,
      http_status: input.httpStatus || null,
      method: input.method || null,
      route: input.route || null,
      request_id: input.requestId,
      trace_id: input.traceId || null,
      actor_user_id: input.actorUserId || null,
      context_json: input.contextJson,
    };

    await appendFile(targetPath, `${JSON.stringify(entry)}\n`, 'utf8');
  } catch (error) {
    console.warn(
      '[ErrorEventMirror] failed to append local mirror:',
      error instanceof Error ? error.message : String(error)
    );
  }
}
