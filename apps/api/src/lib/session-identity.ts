import type { FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { queryRowsWithPgSystemContext } from './pg-context';
import {
  INTERNAL_AUTH_ISSUER,
  bumpResolverMetric,
  extractCandidateSessionTokens,
  getSessionResolverMetricsSnapshot,
  normalizeRole,
  normalizeStatus,
  resetSessionResolverMetrics,
} from './session-identity/helpers';
import type {
  ResolveIdentityResult,
  ResolveProfileStatusResult,
  SessionIdentityRow,
} from './session-identity/types';

export type {
  ActorIdentity,
  ProfileStatusIdentity,
  SessionResolverMetrics,
} from './session-identity/types';
export { getSessionResolverMetricsSnapshot, resetSessionResolverMetrics };

async function resolveProfileStatusLocally(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<ResolveProfileStatusResult> {
  const tokens = extractCandidateSessionTokens(request, config);
  if (tokens.length === 0) {
    return { kind: 'unauthorized' };
  }

  try {
    const rows = await queryRowsWithPgSystemContext<SessionIdentityRow>(
      `
        SELECT
          s.user_id::text AS auth_user_id,
          COALESCE(ui.user_id, s.user_id)::text AS user_id,
          p.role::text AS role,
          p.status::text AS status
        FROM auth_sessions s
        LEFT JOIN user_identities ui
          ON ui.issuer = $2::text
          AND ui.subject = s.user_id::text
        LEFT JOIN profiles p
          ON p.id = COALESCE(ui.user_id, s.user_id)
        WHERE s.expires_at > NOW()
          AND s.token = ANY($1::text[])
        ORDER BY s.updated_at DESC NULLS LAST, s.created_at DESC NULLS LAST
        LIMIT 1
      `,
      [tokens, INTERNAL_AUTH_ISSUER]
    );

    const row = rows[0];
    if (!row || !row.auth_user_id || !row.user_id) {
      return { kind: 'unauthorized' };
    }

    const status = normalizeStatus(row.status);
    if (status !== 'active') {
      return { kind: 'unauthorized' };
    }

    return {
      kind: 'ok',
      identity: {
        userId: row.user_id,
        authUserId: row.auth_user_id,
        role: normalizeRole(row.role),
        status,
      },
    };
  } catch (error) {
    return {
      kind: 'error',
      reason:
        error instanceof Error
          ? error.message
          : 'Unknown local profile-status resolve error',
    };
  }
}

export async function resolveProfileStatusFromSession(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<ResolveProfileStatusResult> {
  const local = await resolveProfileStatusLocally(request, config);
  if (local.kind === 'ok') {
    bumpResolverMetric('local_ok');
    return local;
  }
  if (local.kind === 'unauthorized') {
    bumpResolverMetric('local_unauthorized');
    return local;
  }
  bumpResolverMetric('local_error');
  return local;
}

export async function resolveIdentityFromSession(
  request: FastifyRequest,
  config: ApiRuntimeConfig
): Promise<ResolveIdentityResult> {
  const resolved = await resolveProfileStatusFromSession(request, config);
  if (resolved.kind !== 'ok') {
    return resolved;
  }

  return {
    kind: 'ok',
    identity: {
      userId: resolved.identity.userId,
      role: resolved.identity.role,
    },
  };
}
