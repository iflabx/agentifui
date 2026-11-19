import type { AppDiagnosticResult } from '@agentifui/shared';
import type { FastifyPluginAsync } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { AGENT_APP_VISIBILITY_SQL, decryptCredential } from '../lib/agent-app';
import { resolveBackendType } from '../lib/agent-backends';
import { diagnoseApp } from '../lib/app-diagnostics';
import { queryRowsWithPgSystemContext } from '../lib/pg-context';
import { buildRouteErrorPayload } from '../lib/route-error';
import { resolveIdentityFromSession } from '../lib/session-identity';

interface DiagnosticBody {
  providerId: string;
  serviceInstanceId?: string;
  backend: 'dify' | 'langchain';
  apiKey?: string;
  assistantId?: string;
  humanInput?: boolean;
  resultProfileEnabled?: boolean;
}

export const adminAppDiagnosticsRoutes: FastifyPluginAsync<{
  config: ApiRuntimeConfig;
}> = async (app, { config }) => {
  app.post<{ Body: DiagnosticBody }>(
    '/api/admin/app-diagnostics',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['providerId', 'backend'],
          properties: {
            providerId: { type: 'string', format: 'uuid' },
            serviceInstanceId: { type: 'string', format: 'uuid' },
            backend: { type: 'string', enum: ['dify', 'langchain'] },
            apiKey: { type: 'string', maxLength: 4096 },
            assistantId: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,128}$' },
            humanInput: { type: 'boolean' },
            resultProfileEnabled: { type: 'boolean' },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      const identity = await resolveIdentityFromSession(request, config);
      if (identity.kind !== 'ok' || identity.identity.role !== 'admin') {
        const statusCode =
          identity.kind === 'error'
            ? 503
            : identity.kind === 'unauthorized'
              ? 401
              : 403;
        return reply.status(statusCode).send(
          buildRouteErrorPayload({
            request,
            statusCode,
            source: 'auth',
            code: 'APP_DIAGNOSTICS_FORBIDDEN',
            userMessage: 'Administrator access is required.',
          })
        );
      }
      const fail = (code: AppDiagnosticResult['code']) =>
        reply.send({
          status: 'error',
          code,
          capabilities: [],
        } satisfies AppDiagnosticResult);
      try {
        const body = request.body;
        const providers = await queryRowsWithPgSystemContext<{
          base_url: string;
          type: string;
        }>(
          'SELECT base_url, type FROM providers WHERE id = $1::uuid AND is_active = TRUE',
          [body.providerId]
        );
        const provider = providers[0];
        if (
          !provider ||
          (body.backend === 'langchain'
            ? provider.type !== 'langchain'
            : !['dify', 'llm'].includes(provider.type))
        )
          return fail('invalidConfiguration');
        let base: URL;
        try {
          base = new URL(provider.base_url);
          if (
            !['http:', 'https:'].includes(base.protocol) ||
            base.username ||
            base.password ||
            base.search ||
            base.hash
          )
            return fail('invalidConfiguration');
        } catch {
          return fail('invalidConfiguration');
        }
        if (body.backend === 'langchain' && !body.assistantId)
          return fail('invalidConfiguration');
        let apiKey = body.apiKey?.trim();
        if (!apiKey && body.serviceInstanceId) {
          const rows = await queryRowsWithPgSystemContext<{
            provider_id: string;
            config: Record<string, unknown> | null;
            key_value: string | null;
          }>(
            `SELECT si.provider_id::text, si.config, (
               SELECT key_value FROM api_keys
               WHERE service_instance_id = si.id AND is_default = TRUE
               ORDER BY created_at ASC, id ASC LIMIT 1
             ) AS key_value
             FROM service_instances si
             WHERE si.id = $1::uuid AND ${AGENT_APP_VISIBILITY_SQL}
             LIMIT 1`,
            [body.serviceInstanceId, identity.identity.userId]
          );
          const saved = rows[0];
          if (
            !saved ||
            saved.provider_id !== body.providerId ||
            resolveBackendType(saved.config) !== body.backend
          )
            return fail('invalidConfiguration');
          if (!saved.key_value) return fail('credentialsRequired');
          apiKey = decryptCredential(saved.key_value);
        }
        if (!apiKey?.trim()) return fail('credentialsRequired');
        if (/[\r\n]/.test(apiKey)) return fail('invalidConfiguration');
        return reply.send(
          await diagnoseApp({
            backend: body.backend,
            baseUrl: base.toString().replace(/\/+$/, ''),
            apiKey,
            assistantId: body.assistantId,
            humanInput: body.humanInput,
            resultProfileEnabled: body.resultProfileEnabled,
          })
        );
      } catch {
        return fail('unavailable');
      }
    }
  );
};
