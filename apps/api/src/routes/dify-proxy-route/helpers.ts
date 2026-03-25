import type { FastifyReply } from 'fastify';

import type { AgentErrorSource } from '../../lib/agent-error';

const DEFAULT_DIFY_PROXY_TIMEOUT_MS = 30000;

export function resolveDifyProxyTimeoutMs(): number {
  const raw = process.env.DIFY_PROXY_TIMEOUT_MS?.trim();
  if (!raw) {
    return DEFAULT_DIFY_PROXY_TIMEOUT_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 1000
    ? parsed
    : DEFAULT_DIFY_PROXY_TIMEOUT_MS;
}

export function isObjectRecord(
  payload: unknown
): payload is Record<string, unknown> {
  return (
    Boolean(payload) && typeof payload === 'object' && !Array.isArray(payload)
  );
}

function isWorkflowAppType(appType?: string): boolean {
  return (appType || '').trim().toLowerCase() === 'workflow';
}

function isTextGenerationAppType(appType?: string): boolean {
  return (appType || '').trim().toLowerCase() === 'text-generation';
}

export function adjustApiPathByAppType(
  slug: string[],
  appType: string | undefined
): string {
  const originalPath = slug.join('/');

  if (!appType) {
    return originalPath;
  }

  if (isWorkflowAppType(appType)) {
    const commonApis = ['info', 'parameters', 'files/upload', 'audio-to-text'];
    const isCommonApi = commonApis.some(api => originalPath.startsWith(api));
    if (!isCommonApi && !originalPath.startsWith('workflows/')) {
      return `workflows/${originalPath}`;
    }
  }

  if (isTextGenerationAppType(appType)) {
    if (originalPath === 'messages' || originalPath === 'chat-messages') {
      return 'completion-messages';
    }
    if (originalPath.startsWith('chat-messages')) {
      return originalPath.replace('chat-messages', 'completion-messages');
    }
  }

  return originalPath;
}

export function inferAgentSource(slugPath: string): AgentErrorSource {
  if (slugPath.startsWith('workflows/')) {
    return 'dify-workflow';
  }
  if (slugPath.startsWith('completion-messages')) {
    return 'dify-completion';
  }
  if (slugPath.startsWith('chat-messages')) {
    return 'dify-chat';
  }
  return 'agent-generic';
}

export function resolveRequestLocale(
  languageHeader: string | string[] | undefined
): string | undefined {
  const rawValue =
    typeof languageHeader === 'string'
      ? languageHeader
      : Array.isArray(languageHeader)
        ? languageHeader[0]
        : '';

  if (!rawValue) {
    return undefined;
  }

  const firstItem = rawValue.split(',')[0]?.trim();
  return firstItem || undefined;
}

export function extractRoutePath(
  rawUrl: string | undefined,
  fallback: string
): string {
  if (!rawUrl) {
    return fallback;
  }
  const index = rawUrl.indexOf('?');
  if (index < 0) {
    return rawUrl;
  }
  return rawUrl.slice(0, index);
}

export function extractRawQuery(rawUrl: string | undefined): string {
  if (!rawUrl) {
    return '';
  }
  const index = rawUrl.indexOf('?');
  if (index < 0) {
    return '';
  }
  return rawUrl.slice(index);
}

export function isMediaContentType(contentType: string): boolean {
  const normalized = contentType.toLowerCase();
  return (
    normalized.startsWith('audio/') ||
    normalized.startsWith('video/') ||
    normalized.startsWith('image/') ||
    normalized.startsWith('application/pdf') ||
    normalized.startsWith('application/octet-stream')
  );
}

export function copyHeaders(
  reply: FastifyReply,
  source: Headers,
  allow: (key: string) => boolean
): void {
  source.forEach((value, key) => {
    if (allow(key.toLowerCase())) {
      reply.header(key, value);
    }
  });
}

export function copyRawHeaders(
  reply: FastifyReply,
  source: Headers,
  allow: (key: string) => boolean
): void {
  source.forEach((value, key) => {
    if (allow(key.toLowerCase())) {
      reply.raw.setHeader(key, value);
    }
  });
}

export function getChunkByteLength(chunk: unknown): number {
  if (typeof chunk === 'string') {
    return Buffer.byteLength(chunk);
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk.byteLength;
  }
  if (chunk instanceof Uint8Array) {
    return chunk.byteLength;
  }
  return 0;
}

export function isReplyCommitted(reply: FastifyReply): boolean {
  return (
    reply.sent ||
    reply.raw.headersSent ||
    reply.raw.writableEnded ||
    reply.raw.destroyed
  );
}

export function normalizeRequestBody(payload: unknown): BodyInit | null {
  if (payload === null || typeof payload === 'undefined') {
    return null;
  }
  if (Buffer.isBuffer(payload)) {
    return payload;
  }
  if (payload instanceof Uint8Array) {
    return payload;
  }
  if (typeof payload === 'string') {
    return payload;
  }
  if (isObjectRecord(payload) || Array.isArray(payload)) {
    return JSON.stringify(payload);
  }
  return null;
}
