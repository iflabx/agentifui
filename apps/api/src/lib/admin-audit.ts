import { sanitizeDiagnosticText } from '@agentifui/shared';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';

import {
  toErrorResponse,
  toSuccessResponse,
} from '../routes/internal-data-route/helpers';
import type { ApiActionResponse } from '../routes/internal-data-route/types';
import {
  getPgPool,
  queryRowsWithPgSystemContext,
  runWithPgSystemContext,
} from './pg-context';
import { INTERNAL_AUTH_ISSUER } from './session-identity/helpers';

export const AUDITED_ADMIN_ACTIONS = new Set([
  'users.updateUserProfile',
  'users.deleteUser',
  'users.createUserProfile',
  'users.batchUpdateUserStatus',
  'users.batchUpdateUserRole',
  'users.revokeAllSessions',
  'groups.addGroupMember',
  'groups.removeGroupMember',
  'groups.deleteGroup',
  'groups.setGroupAppPermission',
  'groups.removeGroupAppPermission',
  'groups.removeAllGroupAppPermissions',
  'apiKeys.create',
  'apiKeys.update',
  'apiKeys.delete',
  'serviceInstances.delete',
  'providers.deleteProvider',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isAuditedAdminAction(
  action: string,
  payload?: Record<string, unknown>
): boolean {
  return (
    AUDITED_ADMIN_ACTIONS.has(action) ||
    action === 'apps.updateVisibility' ||
    (action === 'serviceInstances.update' &&
      Object.hasOwn(object(payload?.updates), 'visibility'))
  );
}
function uuid(value: unknown): string | null {
  return typeof value === 'string' && UUID.test(value.trim())
    ? value.trim()
    : null;
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function targets(payload: Record<string, unknown>, action: string): string[] {
  const values = action.startsWith('users.batch')
    ? Array.isArray(payload.userIds)
      ? payload.userIds
      : []
    : [payload.userId];
  if (values.length > 100) throw new Error('ADMIN_BATCH_LIMIT');
  if (values.some(value => value !== undefined && !uuid(value)))
    throw new Error('ADMIN_TARGET_INVALID');
  return [
    ...new Set(
      values.map(uuid).filter((value): value is string => Boolean(value))
    ),
  ].sort();
}

function countChanges(before: unknown[], after: unknown[]): number {
  const keyed = (rows: unknown[]) =>
    new Map(
      rows.map(value => {
        const row = object(value);
        return [
          `${row.kind || ''}:${row.id || object(row.detail).id}`,
          JSON.stringify(value),
        ];
      })
    );
  const old = keyed(before),
    current = keyed(after);
  return [...new Set([...old.keys(), ...current.keys()])].filter(
    key => old.get(key) !== current.get(key)
  ).length;
}

export interface AdminAuditInput {
  action: string;
  payload: Record<string, unknown>;
  actorUserId?: string;
  tokens: string[];
  requestId: string;
}

async function snapshot(
  client: PoolClient,
  action: string,
  payload: Record<string, unknown>
): Promise<unknown[]> {
  if (
    action === 'apps.updateVisibility' ||
    action === 'serviceInstances.update'
  )
    return (
      await client.query(
        'SELECT id,provider_id,visibility,is_default FROM service_instances WHERE id=$1::uuid OR provider_id=ANY($2::uuid[]) ORDER BY id LIMIT 101',
        [uuid(payload.id), payload.auditProviders || []]
      )
    ).rows;
  if (
    action === 'serviceInstances.delete' ||
    action === 'providers.deleteProvider'
  ) {
    return (
      await client.query(
        `WITH applications AS (SELECT id,provider_id,visibility,is_default FROM service_instances WHERE provider_id=$1::uuid),
      affected AS (
        SELECT 'provider' AS kind,id,jsonb_build_object('id',id,'active',is_active,'default',is_default) AS detail FROM providers WHERE id=$1::uuid
        UNION ALL SELECT 'application',id,to_jsonb(a) FROM applications a
        UNION ALL SELECT 'credential',k.id,jsonb_build_object('id',k.id,'providerId',k.provider_id,'appId',k.service_instance_id,'version',k.credential_version,'default',k.is_default)
          FROM api_keys k WHERE ($2::uuid IS NULL AND k.provider_id=$1::uuid)
            OR k.service_instance_id IN(SELECT id FROM applications WHERE $2::uuid IS NULL OR id=$2::uuid)
        UNION ALL SELECT 'grant',g.id,jsonb_build_object('id',g.id,'groupId',g.group_id,'appId',g.service_instance_id,'enabled',g.is_enabled,'quota',g.usage_quota)
          FROM group_app_permissions g WHERE g.service_instance_id IN(SELECT id FROM applications WHERE $2::uuid IS NULL OR id=$2::uuid))
      SELECT kind,detail FROM affected ORDER BY kind,id LIMIT 101`,
        [
          payload.auditProviderId || uuid(payload.id),
          action === 'serviceInstances.delete' ? uuid(payload.id) : null,
        ]
      )
    ).rows;
  }
  if (action.startsWith('users.')) {
    return (
      await client.query(
        'SELECT id, role, status FROM profiles WHERE id = ANY($1::uuid[]) ORDER BY id',
        [targets(payload, action)]
      )
    ).rows;
  }
  if (action.startsWith('apiKeys.')) {
    const key = object(payload.apiKey);
    return (
      await client.query(
        `SELECT id, provider_id, service_instance_id, user_id, is_default, credential_version,
      (SELECT selected.id FROM api_keys selected WHERE selected.service_instance_id=api_keys.service_instance_id AND selected.is_default ORDER BY selected.created_at,selected.id LIMIT 1) AS effective_key_id
      FROM api_keys WHERE id = $1::uuid OR service_instance_id = ANY($2::uuid[])
        OR (service_instance_id IS NULL AND provider_id=ANY($3::uuid[])) ORDER BY id LIMIT 101`,
        [
          uuid(payload.auditId) || uuid(payload.id),
          payload.auditServices ||
            [uuid(key.service_instance_id)].filter(Boolean),
          payload.auditProviders || [],
        ]
      )
    ).rows;
  }
  const groupId = uuid(payload.groupId);
  const appId = uuid(payload.serviceInstanceId);
  const member = action.includes('Member');
  const permissions = (
    await client.query(
      member
        ? `SELECT id, group_id, user_id FROM group_members WHERE group_id = $1::uuid AND user_id = $2::uuid ORDER BY id LIMIT 101`
        : `SELECT id, group_id, service_instance_id, is_enabled, usage_quota FROM group_app_permissions
       WHERE ($1::uuid IS NOT NULL AND group_id = $1::uuid OR $1::uuid IS NULL AND service_instance_id = $2::uuid)
       AND ($2::uuid IS NULL OR service_instance_id = $2::uuid) ORDER BY id LIMIT 101`,
      [groupId, member ? uuid(payload.userId) : appId]
    )
  ).rows;
  if (action === 'groups.deleteGroup') {
    const members = (
      await client.query(
        'SELECT id,group_id,user_id FROM group_members WHERE group_id=$1::uuid ORDER BY id LIMIT 101',
        [groupId]
      )
    ).rows;
    const groups = (
      await client.query('SELECT id FROM groups WHERE id=$1::uuid', [groupId])
    ).rows;
    return [
      ...groups.map(row => ({ kind: 'group', ...row })),
      ...permissions.map(row => ({ kind: 'permission', ...row })),
      ...members.map(row => ({ kind: 'member', ...row })),
    ];
  }
  return permissions;
}

async function snapshotScope(
  client: PoolClient,
  input: AdminAuditInput
): Promise<Record<string, unknown>> {
  const payload: Record<string, unknown> = {
    ...input.payload,
    auditServices: [] as string[],
    auditProviderId: null as string | null,
  };
  if (input.action.startsWith('apiKeys.')) {
    const old = await client.query(
      'SELECT service_instance_id,provider_id FROM api_keys WHERE id=$1::uuid',
      [uuid(payload.id)]
    );
    payload.auditServices = [
      ...new Set(
        [
          old.rows[0]?.service_instance_id,
          uuid(object(payload.apiKey).service_instance_id),
          uuid(object(payload.updates).service_instance_id),
        ].filter((value): value is string => Boolean(value))
      ),
    ];
    payload.auditProviders = [
      ...new Set(
        [
          old.rows[0]?.provider_id,
          uuid(object(payload.apiKey).provider_id),
          uuid(object(payload.updates).provider_id),
        ].filter((value): value is string => Boolean(value))
      ),
    ];
  }
  if (input.action === 'serviceInstances.delete')
    payload.auditProviderId =
      (
        await client.query(
          'SELECT provider_id FROM service_instances WHERE id=$1::uuid',
          [uuid(payload.id)]
        )
      ).rows[0]?.provider_id || null;
  if (input.action === 'serviceInstances.update')
    payload.auditProviders = [
      ...new Set(
        [
          (
            await client.query(
              'SELECT provider_id FROM service_instances WHERE id=$1::uuid',
              [uuid(payload.id)]
            )
          ).rows[0]?.provider_id,
          uuid(object(payload.updates).provider_id),
        ].filter(Boolean)
      ),
    ];
  return payload;
}

async function insertEvent(
  client: PoolClient,
  input: AdminAuditInput,
  operationId: string,
  outcome: 'committed' | 'failed' | 'denied',
  changes: Record<string, unknown> = {},
  reason?: string,
  createdId?: string | null
): Promise<void> {
  const targetType =
    input.action === 'groups.removeAllGroupAppPermissions'
      ? 'serviceInstances'
      : input.action.split('.')[0];
  const targetId =
    input.action === 'apiKeys.create'
      ? createdId || null
      : input.action.startsWith('users.batch')
        ? null
        : targetType === 'users'
          ? uuid(input.payload.userId)
          : targetType === 'groups'
            ? uuid(input.payload.groupId)
            : input.action === 'groups.removeAllGroupAppPermissions'
              ? uuid(input.payload.serviceInstanceId)
              : uuid(input.payload.id);
  await client.query(
    `INSERT INTO admin_audit_events(operation_id, request_id, actor_kind, actor_user_id,
    action, target_type, target_id, outcome, changes, reason_code)
    VALUES ($1::uuid,$2,'user',$3::uuid,$4,$5,$6,$7,$8::jsonb,$9)`,
    [
      operationId,
      sanitizeDiagnosticText(input.requestId).slice(0, 160),
      uuid(input.actorUserId),
      input.action,
      targetType,
      targetId,
      outcome,
      JSON.stringify(changes),
      reason || null,
    ]
  );
}

export async function recordAdminFailure(
  input: AdminAuditInput,
  operationId: string,
  outcome: 'failed' | 'denied',
  reason: string
): Promise<void> {
  try {
    await runWithPgSystemContext(client =>
      insertEvent(client, input, operationId, outcome, {}, reason)
    );
  } catch {
    console.warn('[AdminAudit] failure record unavailable', {
      operationId,
      reason,
    });
  }
}

async function authorize(
  client: PoolClient,
  input: AdminAuditInput
): Promise<void> {
  const ids = [
    ...new Set(
      [
        input.actorUserId!,
        ...(input.action.startsWith('users.') || input.action.includes('Member')
          ? targets(input.payload, input.action)
          : []),
        uuid(object(input.payload.apiKey).user_id),
        uuid(object(input.payload.updates).user_id),
      ].filter((value): value is string => Boolean(value))
    ),
  ].sort();
  if (
    input.action === 'users.deleteUser' ||
    input.action === 'users.revokeAllSessions'
  ) {
    await client.query(
      `SELECT id FROM auth_users WHERE id IN (
      SELECT au.id FROM auth_users au JOIN user_identities ui ON ui.subject=au.id::text WHERE ui.issuer = $2 AND ui.user_id = ANY($1::uuid[])
      UNION SELECT id FROM profiles WHERE id = ANY($1::uuid[])) ORDER BY id FOR UPDATE NOWAIT`,
      [ids, INTERNAL_AUTH_ISSUER]
    );
  }
  await client.query(
    'SELECT id FROM profiles WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE NOWAIT',
    [ids]
  );
  const actor = await client.query(
    `SELECT p.id FROM auth_sessions s
    LEFT JOIN user_identities ui ON ui.issuer = $3 AND ui.subject = s.user_id::text
    JOIN profiles p ON p.id = COALESCE(ui.user_id,s.user_id)
    WHERE s.token = ANY($1::text[]) AND s.expires_at > NOW()
      AND p.id = $2::uuid AND p.status = 'active' AND p.role = 'admin' LIMIT 1`,
    [input.tokens, input.actorUserId, INTERNAL_AUTH_ISSUER]
  );
  if (!actor.rows.length) throw new Error('ADMIN_AUTHORIZATION_REVOKED');
  if (input.action.startsWith('groups.')) {
    const groupId = uuid(input.payload.groupId);
    if (groupId)
      await client.query(
        'SELECT id FROM groups WHERE id=$1::uuid FOR UPDATE NOWAIT',
        [groupId]
      );
    if (!input.action.includes('Member'))
      await client.query(
        'SELECT id FROM service_instances WHERE id=$1::uuid FOR UPDATE NOWAIT',
        [uuid(input.payload.serviceInstanceId)]
      );
    if (input.action.includes('Member'))
      await client.query(
        'SELECT id FROM group_members WHERE group_id=$1::uuid AND user_id=$2::uuid ORDER BY id FOR UPDATE NOWAIT',
        [groupId, uuid(input.payload.userId)]
      );
    else
      await client.query(
        `SELECT id FROM group_app_permissions WHERE ($1::uuid IS NOT NULL AND group_id=$1::uuid OR $1::uuid IS NULL AND service_instance_id=$2::uuid)
      AND ($2::uuid IS NULL OR service_instance_id=$2::uuid) ORDER BY id FOR UPDATE NOWAIT`,
        [groupId, uuid(input.payload.serviceInstanceId)]
      );
  }
  if (input.action.startsWith('apiKeys.'))
    await client.query(
      'SELECT id FROM api_keys WHERE id=$1::uuid FOR UPDATE NOWAIT',
      [uuid(input.payload.id)]
    );
  if (input.action === 'apps.updateVisibility')
    await client.query(
      'SELECT id FROM service_instances WHERE id=$1::uuid FOR UPDATE NOWAIT',
      [uuid(input.payload.id)]
    );
  if (input.action === 'serviceInstances.update')
    await client.query(
      `SELECT id FROM service_instances
    WHERE id=$1::uuid OR provider_id IN(SELECT provider_id FROM service_instances WHERE id=$1::uuid)
      OR provider_id=$2::uuid ORDER BY id FOR UPDATE NOWAIT`,
      [uuid(input.payload.id), uuid(object(input.payload.updates).provider_id)]
    );
  if (input.action === 'providers.deleteProvider')
    await client.query(
      'SELECT id FROM providers WHERE id=$1::uuid FOR UPDATE NOWAIT',
      [uuid(input.payload.id)]
    );
  if (
    input.action === 'providers.deleteProvider' ||
    input.action === 'serviceInstances.delete'
  ) {
    const applications = await client.query(
      `SELECT id FROM service_instances WHERE provider_id=${input.action === 'providers.deleteProvider' ? '$1::uuid' : '(SELECT provider_id FROM service_instances WHERE id=$1::uuid)'} ORDER BY id FOR UPDATE NOWAIT`,
      [uuid(input.payload.id)]
    );
    for (const app of applications.rows) {
      const lock = await client.query(
        "SELECT pg_try_advisory_xact_lock(hashtextextended('agent-app:' || $1::text,0)) AS locked",
        [app.id]
      );
      if (!lock.rows[0]?.locked) throw new Error('AGENT_CONFIG_BUSY');
    }
  }
}

class RejectedMutation extends Error {
  constructor(readonly response: ApiActionResponse) {
    super('ADMIN_MUTATION_REJECTED');
  }
}

export async function runAuditedAdminMutation(
  input: AdminAuditInput,
  operation: (client: PoolClient) => Promise<ApiActionResponse | null>
): Promise<ApiActionResponse> {
  if (input.action === 'groups.removeAllGroupAppPermissions')
    input = { ...input, payload: { ...input.payload, groupId: undefined } };
  if (input.action === 'groups.deleteGroup' || input.action.includes('Member'))
    input = {
      ...input,
      payload: { ...input.payload, serviceInstanceId: undefined },
    };
  const operationId = randomUUID();
  const client = await getPgPool().connect();
  let committing = false;
  let committedResponse: ApiActionResponse | null = null;
  let businessRunning = false;
  let released = false;
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.rls_system_actor','true',true)");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query("SET LOCAL statement_timeout = '10s'");
    await authorize(client, input);
    const scope = await snapshotScope(client, input);
    const before = await snapshot(client, input.action, scope);
    if (before.length > 100) throw new Error('ADMIN_BATCH_LIMIT');
    businessRunning = true;
    const response = await operation(client);
    businessRunning = false;
    if (!response || response.statusCode >= 400)
      throw new RejectedMutation(
        response || toErrorResponse('Unsupported mutation', 400)
      );
    if (input.action === 'apiKeys.create')
      scope.auditId = uuid(object(object(response.payload).data).id);
    const after = await snapshot(client, input.action, scope);
    if (after.length > 100) throw new Error('ADMIN_BATCH_LIMIT');
    const revokedCount =
      input.action === 'users.revokeAllSessions'
        ? Number(object(object(response.payload).data).revokedCount) || 0
        : 0;
    const changedCount = countChanges(before, after);
    const changed = changedCount > 0 || revokedCount > 0;
    await insertEvent(
      client,
      input,
      operationId,
      'committed',
      {
        before,
        after,
        changed,
        changedCount,
        credentialChanged:
          countChanges(
            before.filter(
              row =>
                input.action.startsWith('apiKeys.') ||
                object(row).kind === 'credential'
            ),
            after.filter(
              row =>
                input.action.startsWith('apiKeys.') ||
                object(row).kind === 'credential'
            )
          ) > 0,
        ...(input.action === 'users.revokeAllSessions'
          ? { revokedCount: object(object(response.payload).data).revokedCount }
          : {}),
      },
      undefined,
      uuid(scope.auditId)
    );
    committedResponse = {
      ...response,
      payload: { ...object(response.payload), operationId },
    };
    committing = true;
    await client.query('COMMIT');
    return committedResponse;
  } catch (error) {
    const sqlState = object(error).code;
    const confirmedRollback =
      typeof sqlState === 'string' &&
      (/^23/.test(sqlState) || ['40001', '40P01'].includes(sqlState));
    if (committing && !confirmedRollback) {
      client.release(true);
      released = true;
      try {
        const rows = await queryRowsWithPgSystemContext(
          "SELECT operation_id FROM admin_audit_events WHERE operation_id=$1::uuid AND outcome='committed'",
          [operationId]
        );
        if (rows.length && committedResponse)
          return {
            ...committedResponse,
            payload: {
              ...object(committedResponse.payload),
              requiresRefresh: true,
            },
          };
      } catch {}
      return {
        ...toErrorResponse(
          'Operation result unknown; query audit by operationId before retrying',
          503
        ),
        payload: { success: false, error: 'ADMIN_COMMIT_UNKNOWN', operationId },
      };
    }
    try {
      await client.query('ROLLBACK');
    } catch {}
    client.release();
    released = true;
    const reason =
      sqlState === '55P03'
        ? 'ADMIN_MUTATION_BUSY'
        : error instanceof Error &&
            /^[A-Z_]+$/.test(error.message) &&
            (!sqlState || sqlState === '23514')
          ? error.message
          : 'ADMIN_MUTATION_FAILED';
    const denied = reason === 'ADMIN_AUTHORIZATION_REVOKED';
    await recordAdminFailure(
      input,
      operationId,
      denied ? 'denied' : 'failed',
      reason
    );
    if (error instanceof RejectedMutation)
      return {
        ...error.response,
        payload: { ...object(error.response.payload), operationId },
      };
    const busy =
      sqlState === '55P03' ||
      ((!sqlState || sqlState === '23514') &&
        ['AGENT_CONFIG_BUSY', 'AGENT_QUOTA_BUSY'].includes(reason));
    return {
      ...toErrorResponse(
        denied ? 'Unauthorized access' : 'Management operation unavailable',
        denied ? 403 : busy ? 409 : businessRunning ? 500 : 503
      ),
      payload: { success: false, error: reason, operationId },
    };
  } finally {
    if (!released) client.release();
  }
}

export async function listAdminAudit(
  payload: Record<string, unknown>
): Promise<ApiActionResponse> {
  if (payload.operationId !== undefined && !uuid(payload.operationId))
    return toErrorResponse('Invalid operationId', 400);
  if (
    payload.limit !== undefined &&
    (!Number.isSafeInteger(Number(payload.limit)) ||
      Number(payload.limit) < 1 ||
      Number(payload.limit) > 100)
  )
    return toErrorResponse('Invalid limit', 400);
  const limit = Math.min(
    100,
    Math.max(1, Math.floor(Number(payload.limit) || 25))
  );
  const cursor = object(payload.cursor);
  if (
    payload.cursor !== undefined &&
    (typeof payload.cursor !== 'object' ||
      payload.cursor === null ||
      Array.isArray(payload.cursor) ||
      !cursor.id ||
      !cursor.createdAt)
  )
    return toErrorResponse('Invalid cursor', 400);
  if (
    (cursor.id || cursor.createdAt) &&
    (!uuid(cursor.id) ||
      typeof cursor.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(cursor.createdAt)))
  )
    return toErrorResponse('Invalid cursor', 400);
  const rows = await queryRowsWithPgSystemContext(
    `SELECT id,operation_id,request_id,actor_kind,actor_user_id,actor_label,
    action,target_type,target_id,outcome,changes,reason_code,created_at::text AS created_at FROM admin_audit_events
    WHERE ($1::uuid IS NULL OR operation_id=$1::uuid)
      AND ($2::text IS NULL OR action=$2)
      AND ($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::uuid))
    ORDER BY created_at DESC,id DESC LIMIT $5`,
    [
      uuid(payload.operationId),
      typeof payload.action === 'string' ? payload.action.slice(0, 100) : null,
      cursor.createdAt || null,
      uuid(cursor.id),
      limit,
    ]
  );
  return toSuccessResponse(rows);
}
