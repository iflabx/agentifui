import { createDecipheriv, createHash } from 'node:crypto';

import { LANGCHAIN_CAPABILITIES, resolveBackendType } from './agent-backends';
import { queryRowsWithPgSystemContext } from './pg-context';

export const AGENT_CAPABILITIES = LANGCHAIN_CAPABILITIES;

export interface AgentApp {
  id: string;
  instanceId: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  credentialVersion?: string;
  assistantId: string;
  fingerprint: string;
}

export function agentConfigFingerprint(
  id: string,
  baseUrl: string,
  assistantId: string
): string {
  const normalizedBase = new URL(baseUrl).toString().replace(/\/+$/, '');
  return createHash('sha256')
    .update(JSON.stringify([id, normalizedBase, assistantId]))
    .digest('hex');
}

export class AgentAppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string
  ) {
    super(code);
  }
}

interface AgentAppRow {
  id: string;
  instance_id: string;
  display_name: string | null;
  base_url: string;
  config: Record<string, unknown> | null;
  key_value: string | null;
  credential_version?: string;
}

export const AGENT_APP_VISIBILITY_SQL = `
  EXISTS (
    SELECT 1 FROM profiles actor
    WHERE actor.id = $2::uuid AND actor.status = 'active'
      AND (
        actor.role = 'admin' OR si.visibility = 'public'
        OR (si.visibility = 'group_only' AND EXISTS (
          SELECT 1 FROM group_app_permissions gap
          JOIN group_members gm ON gm.group_id = gap.group_id
          WHERE gap.service_instance_id = si.id AND gap.is_enabled = TRUE
            AND gm.user_id = actor.id
        ))
      )
  )
`;

function decryptCredential(value: string): string {
  if (!value.includes(':')) {
    return value;
  }
  const masterKey = process.env.API_ENCRYPTION_KEY;
  if (!masterKey) {
    throw new AgentAppError(503, 'AGENT_NOT_CONFIGURED');
  }
  try {
    const parts = value.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted credential');
    }
    const [iv, tag, ciphertext] = parts;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      createHash('sha256').update(masterKey).digest(),
      Buffer.from(iv, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return decipher.update(ciphertext, 'hex', 'utf8') + decipher.final('utf8');
  } catch {
    throw new AgentAppError(503, 'AGENT_NOT_CONFIGURED');
  }
}

export async function resolveAgentApp(
  serviceInstanceId: string,
  userId: string
): Promise<AgentApp> {
  const rows = await queryRowsWithPgSystemContext<AgentAppRow>(
    `SELECT si.id::text, si.instance_id, si.display_name, si.config,
       p.base_url, (
         SELECT key_value FROM api_keys
         WHERE service_instance_id = si.id AND is_default = TRUE
         ORDER BY created_at ASC, id ASC LIMIT 1
       ) AS key_value, (
         SELECT credential_version::text FROM api_keys
         WHERE service_instance_id = si.id AND is_default = TRUE
         ORDER BY created_at ASC, id ASC LIMIT 1
       ) AS credential_version
     FROM service_instances si
     JOIN providers p ON p.id = si.provider_id AND p.is_active = TRUE
     WHERE si.id = $1::uuid AND ${AGENT_APP_VISIBILITY_SQL}
     LIMIT 1`,
    [serviceInstanceId, userId]
  );
  const row = rows[0];
  if (!row) {
    throw new AgentAppError(404, 'AGENT_APP_NOT_FOUND');
  }
  if (resolveBackendType(row.config) !== 'langchain') {
    throw new AgentAppError(409, 'AGENT_BACKEND_MISMATCH');
  }
  const langchain = row.config?.langchain as
    Record<string, unknown> | undefined;
  const assistantId = langchain?.assistant_id;
  if (
    typeof assistantId !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(assistantId) ||
    !row.key_value
  ) {
    throw new AgentAppError(503, 'AGENT_NOT_CONFIGURED');
  }
  let baseUrl: string;
  try {
    const url = new URL(row.base_url);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error('Invalid URL');
    }
    baseUrl = url.toString().replace(/\/+$/, '');
  } catch {
    throw new AgentAppError(503, 'AGENT_NOT_CONFIGURED');
  }
  const apiKey = decryptCredential(row.key_value);
  if (!apiKey.trim() || /[\r\n]/.test(apiKey)) {
    throw new AgentAppError(503, 'AGENT_NOT_CONFIGURED');
  }
  return {
    id: row.id,
    instanceId: row.instance_id,
    name: row.display_name || row.instance_id,
    baseUrl,
    apiKey,
    credentialVersion: row.credential_version,
    assistantId,
    fingerprint: agentConfigFingerprint(row.id, baseUrl, assistantId),
  };
}

export function readAgentAdmissionLimits() {
  const readLimit = (value: string | undefined, fallback: number) => {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(value)) {
      throw new AgentAppError(503, 'AGENT_LIMITS_INVALID');
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 100) {
      throw new AgentAppError(503, 'AGENT_LIMITS_INVALID');
    }
    return parsed;
  };
  return {
    userLimit: readLimit(process.env.AGENT_MAX_ACTIVE_PER_USER, 1),
    appLimit: readLimit(process.env.AGENT_MAX_ACTIVE_PER_APP, 2),
  };
}
