import type { FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';

const FASTIFY_BYPASS_HEADER = 'x-agentifui-fastify-bypass';
const FORWARDED_HEADERS = [
  'accept',
  'accept-language',
  'authorization',
  'cookie',
  'user-agent',
] as const;

export interface ActorIdentity {
  userId: string;
  role: string;
}

type ResolveIdentityResult =
  | { kind: 'ok'; identity: ActorIdentity }
  | { kind: 'unauthorized' }
  | { kind: 'error'; reason: string };

function buildUpstreamHeaders(request: FastifyRequest): Headers {
  const headers = new Headers();
  for (const key of FORWARDED_HEADERS) {
    const value = request.headers[key];
    if (typeof value === 'string' && value.length > 0) {
      headers.set(key, value);
    }
  }
  headers.set(FASTIFY_BYPASS_HEADER, '1');
  return headers;
}

export async function resolveIdentityFromUpstream(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<ResolveIdentityResult> {
  const url = new URL(
    '/api/internal/auth/profile-status',
    config.nextUpstreamBaseUrl
  ).toString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: buildUpstreamHeaders(request),
      signal: controller.signal,
    });

    if (response.status === 401) {
      return { kind: 'unauthorized' };
    }
    if (!response.ok) {
      return {
        kind: 'error',
        reason: `Upstream profile-status failed with ${response.status}`,
      };
    }

    const payload = (await response.json()) as {
      userId?: unknown;
      role?: unknown;
    };
    if (
      typeof payload.userId !== 'string' ||
      payload.userId.trim().length === 0
    ) {
      return {
        kind: 'error',
        reason: 'Upstream profile-status payload missing userId',
      };
    }

    const role =
      typeof payload.role === 'string' && payload.role.trim().length > 0
        ? payload.role
        : 'user';
    return {
      kind: 'ok',
      identity: {
        userId: payload.userId,
        role,
      },
    };
  } catch (error) {
    return {
      kind: 'error',
      reason:
        error instanceof Error
          ? error.message
          : 'Unknown upstream profile-status error',
    };
  } finally {
    clearTimeout(timeout);
  }
}
