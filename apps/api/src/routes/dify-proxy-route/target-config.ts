import type { FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../../config';
import { resolveDifyConfig } from '../../lib/dify-config';
import { buildAppErrorPayload } from './error-handling';
import { isObjectRecord } from './helpers';
import { validateTempConfig } from './temp-config';
import type {
  DifyProxyRequestContext,
  DifyProxyTargetConfig,
  DifyTempConfig,
} from './types';

function extractTempConfig(rawBody: unknown): DifyTempConfig | null {
  if (!isObjectRecord(rawBody)) {
    return null;
  }

  const maybeTemp = rawBody._temp_config;
  if (!isObjectRecord(maybeTemp)) {
    return null;
  }

  const apiUrl =
    typeof maybeTemp.apiUrl === 'string' ? maybeTemp.apiUrl.trim() : '';
  const apiKey =
    typeof maybeTemp.apiKey === 'string' ? maybeTemp.apiKey.trim() : '';

  if (!apiUrl || !apiKey) {
    return null;
  }

  return { apiUrl, apiKey };
}

export async function resolveDifyTargetConfig(
  request: FastifyRequest,
  config: ApiRuntimeConfig,
  context: DifyProxyRequestContext
): Promise<
  | { ok: true; targetConfig: DifyProxyTargetConfig }
  | { ok: false; status: number; payload: unknown }
> {
  const rawBody = request.body;
  const tempConfig =
    request.method === 'POST' ? extractTempConfig(rawBody) : null;

  if (tempConfig) {
    const validation = await validateTempConfig(
      request,
      config,
      context.routePath,
      context.actor,
      tempConfig
    );
    if (!validation.ok) {
      return validation;
    }

    return {
      ok: true,
      targetConfig: {
        difyApiKey: tempConfig.apiKey,
        difyApiUrl: validation.apiUrl,
        tempConfigUsed: true,
        rawBody,
      },
    };
  }

  const difyConfig = await resolveDifyConfig(context.appId, {
    actorUserId: context.actor.userId,
    actorRole: context.actor.role,
  });

  if (!difyConfig) {
    return {
      ok: false,
      status: 400,
      payload: await buildAppErrorPayload({
        request,
        status: 400,
        source: 'agent-generic',
        route: context.routePath,
        method: request.method,
        actorUserId: context.actor.userId,
        code: 'DIFY_CONFIG_NOT_FOUND',
        message: `Configuration for Dify app '${context.appId}' not found`,
      }),
    };
  }

  if (!difyConfig.apiKey || !difyConfig.apiUrl) {
    return {
      ok: false,
      status: 500,
      payload: await buildAppErrorPayload({
        request,
        status: 500,
        source: 'agent-generic',
        route: context.routePath,
        method: request.method,
        actorUserId: context.actor.userId,
        code: 'DIFY_CONFIG_INVALID',
        message: `Server configuration error for app '${context.appId}'`,
      }),
    };
  }

  return {
    ok: true,
    targetConfig: {
      difyApiKey: difyConfig.apiKey,
      difyApiUrl: difyConfig.apiUrl,
      appType: difyConfig.appType,
      tempConfigUsed: false,
      rawBody,
    },
  };
}
