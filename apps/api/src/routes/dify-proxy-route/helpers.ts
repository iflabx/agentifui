import type { FastifyReply } from 'fastify';

import type { AgentErrorSource } from '../../lib/agent-error';

const DEFAULT_DIFY_PROXY_TIMEOUT_MS = 30000;
const WORKFLOW_COMMON_API_PATHS = new Set([
  'info',
  'parameters',
  'meta',
  'site',
  'files/upload',
  'audio-to-text',
  'text-to-audio',
]);

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

export function isDifyFilePreviewPath(path: string): boolean {
  const segments = path.split('/');
  return (
    isValidDifyPath(segments) &&
    segments.length === 3 &&
    segments[0] === 'files' &&
    segments[2] === 'preview'
  );
}

export function adjustApiPathByAppType(
  slug: string[],
  appType: string | undefined
): string {
  const originalPath = slug.join('/');

  if (!appType || !isValidDifyPath(slug)) {
    return originalPath;
  }

  if (isWorkflowAppType(appType)) {
    if (
      WORKFLOW_COMMON_API_PATHS.has(originalPath) ||
      isDifyFilePreviewPath(originalPath)
    ) {
      return originalPath;
    }
    const workflowPath = originalPath.startsWith('workflows/')
      ? originalPath.slice('workflows/'.length)
      : originalPath;
    return /^(?:run(?:\/[^/]+)?|logs|tasks\/[^/]+\/stop|[^/]+\/run)$/.test(
      workflowPath
    )
      ? `workflows/${workflowPath}`
      : '';
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

function normalizeRawQuery(rawQuery: string): string {
  if (!rawQuery) {
    return '';
  }

  return rawQuery.startsWith('?') ? rawQuery.slice(1) : rawQuery;
}

export function buildScopedUpstreamQuery(input: {
  rawQuery: string;
  slugPath: string;
  actorUserId?: string;
}): string {
  const { rawQuery, actorUserId } = input;

  if (!actorUserId) {
    return rawQuery;
  }

  const searchParams = new URLSearchParams(normalizeRawQuery(rawQuery));

  searchParams.set('user', actorUserId);

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

export function isValidDifyPath(slug: string[]): boolean {
  return (
    slug.length > 0 &&
    slug.every(
      segment =>
        /^[A-Za-z0-9._~-]+$/.test(segment) &&
        segment !== '.' &&
        segment !== '..'
    )
  );
}

export async function bindDifyRequestUser(
  rawBody: unknown,
  contentType: string | undefined,
  userId: string
): Promise<Record<string, unknown> | FormData> {
  if (/^multipart\/form-data(?:;|$)/i.test(contentType || '')) {
    if (!(rawBody instanceof Uint8Array) && typeof rawBody !== 'string') {
      throw new Error('Invalid multipart body');
    }
    const form = await new Response(
      typeof rawBody === 'string' ? rawBody : new Uint8Array(rawBody),
      { headers: { 'Content-Type': contentType! } }
    ).formData();
    form.set('user', userId);
    return form;
  }

  let body = rawBody;
  if (typeof body === 'string') {
    if (
      !/^application\/(?:[\w.+-]+\+)?json(?:\s*;|\s*$)/i.test(contentType || '')
    ) {
      throw new Error('Unsupported request body type');
    }
    body = JSON.parse(body);
  }
  if (body == null) {
    return { user: userId };
  }
  if (!isObjectRecord(body) || body instanceof Uint8Array) {
    throw new Error('Invalid JSON body');
  }
  return { ...body, user: userId };
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

function getHopByHopHeaders(source: Headers): Set<string> {
  return new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    ...(source.get('connection') || '')
      .split(',')
      .map(header => header.trim().toLowerCase())
      .filter(Boolean),
  ]);
}

export function copyHeaders(
  reply: FastifyReply,
  source: Headers,
  allow: (key: string) => boolean
): void {
  const hopByHopHeaders = getHopByHopHeaders(source);
  source.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (!hopByHopHeaders.has(normalizedKey) && allow(normalizedKey)) {
      reply.header(key, value);
    }
  });
}

export function copyRawHeaders(
  reply: FastifyReply,
  source: Headers,
  allow: (key: string) => boolean
): void {
  const hopByHopHeaders = getHopByHopHeaders(source);
  source.forEach((value, key) => {
    const normalizedKey = key.toLowerCase();
    if (!hopByHopHeaders.has(normalizedKey) && allow(normalizedKey)) {
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
  if (payload instanceof FormData) {
    return payload;
  }
  if (Buffer.isBuffer(payload)) {
    return new Uint8Array(payload);
  }
  if (payload instanceof Uint8Array) {
    return new Uint8Array(payload);
  }
  if (typeof payload === 'string') {
    return payload;
  }
  if (isObjectRecord(payload) || Array.isArray(payload)) {
    return JSON.stringify(payload);
  }
  return null;
}
