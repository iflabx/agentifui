import type { FastifyRequest } from 'fastify';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

import type { ApiRuntimeConfig } from '../../config';
import { buildAppErrorPayload } from './error-handling';
import type { DifyProxyActor, DifyTempConfig } from './types';

function normalizeHost(value: string): string {
  return value.trim().toLowerCase();
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(value => Number(value));
  if (parts.length !== 4 || parts.some(part => Number.isNaN(part))) {
    return false;
  }
  const [a, b] = parts;
  if (a === 10) {
    return true;
  }
  if (a === 127) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === '::1') {
    return true;
  }
  return (
    normalized.startsWith('fc') ||
    normalized.startsWith('fd') ||
    normalized.startsWith('fe80')
  );
}

function isPrivateIp(ip: string): boolean {
  if (ip.includes('.')) {
    return isPrivateIpv4(ip);
  }
  return isPrivateIpv6(ip);
}

async function isPrivateHost(hostname: string): Promise<boolean> {
  const normalized = normalizeHost(hostname);
  if (
    normalized === 'localhost' ||
    normalized.endsWith('.localhost') ||
    normalized.endsWith('.local')
  ) {
    return true;
  }
  const ipType = isIP(normalized);
  if (ipType) {
    return isPrivateIp(normalized);
  }

  try {
    const results = await lookup(normalized, { all: true });
    if (results.length === 0) {
      return true;
    }
    return results.some(result => isPrivateIp(result.address));
  } catch {
    return true;
  }
}

function isHostAllowed(hostname: string, allowedHosts: string[]): boolean {
  if (allowedHosts.length === 0) {
    return false;
  }
  const normalized = normalizeHost(hostname);
  return allowedHosts.some(entry => {
    const rule = normalizeHost(entry);
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(2);
      return normalized === suffix || normalized.endsWith(`.${suffix}`);
    }
    if (rule.startsWith('.')) {
      const suffix = rule.slice(1);
      return normalized === suffix || normalized.endsWith(`.${suffix}`);
    }
    return normalized === rule;
  });
}

export async function validateTempConfig(
  request: FastifyRequest,
  config: ApiRuntimeConfig,
  routePath: string,
  actor: DifyProxyActor,
  tempConfig: DifyTempConfig
): Promise<
  { ok: true; apiUrl: string } | { ok: false; status: number; payload: unknown }
> {
  const buildError = async (status: number, code: string, message: string) => {
    return {
      ok: false as const,
      status,
      payload: await buildAppErrorPayload({
        request,
        status,
        source: 'dify-proxy',
        route: routePath,
        method: request.method,
        actorUserId: actor.userId,
        code,
        message,
      }),
    };
  };

  if (!config.difyTempConfigEnabled) {
    return buildError(
      403,
      'DIFY_TEMP_CONFIG_DISABLED',
      'Temp config is disabled'
    );
  }

  if (actor.role !== 'admin') {
    return buildError(
      403,
      'DIFY_TEMP_CONFIG_FORBIDDEN',
      'Insufficient permissions'
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(tempConfig.apiUrl);
  } catch {
    return buildError(
      400,
      'DIFY_TEMP_CONFIG_INVALID_URL',
      'Invalid temp config URL'
    );
  }

  if (parsed.username || parsed.password) {
    return buildError(
      400,
      'DIFY_TEMP_CONFIG_INVALID_URL',
      'Temp config URL must not include credentials'
    );
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return buildError(
      400,
      'DIFY_TEMP_CONFIG_INVALID_URL',
      'Temp config URL must use http or https'
    );
  }

  if (!isHostAllowed(parsed.hostname, config.difyTempConfigAllowedHosts)) {
    return buildError(
      403,
      'DIFY_TEMP_CONFIG_HOST_NOT_ALLOWED',
      'Temp config host is not allowed'
    );
  }

  if (!config.difyTempConfigAllowPrivate) {
    const blocked = await isPrivateHost(parsed.hostname);
    if (blocked) {
      return buildError(
        403,
        'DIFY_TEMP_CONFIG_PRIVATE_HOST_BLOCKED',
        'Temp config host is not allowed'
      );
    }
  }

  return { ok: true, apiUrl: parsed.toString() };
}
