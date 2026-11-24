import type { PoolClient } from 'pg';

import { AGENT_APP_VISIBILITY_SQL, type AgentApp } from './agent-app';
import { type AgentBackendType, AgentPolicyError } from './agent-backends';
import { queryRowsWithPgSystemContext } from './pg-context';

export interface AgentInputFileReference {
  fileId: string;
  slotKey: string;
}

interface InputFileScope {
  serviceInstanceId: string;
  userId: string;
  backendType?: AgentBackendType;
  configFingerprint: string;
}

export interface AgentInputFile {
  id: string;
  name: string;
  size: number;
  type: string;
  nativeId: string;
  slotKey: string;
}

export function agentInputFileScope(app: AgentApp, userId: string) {
  return {
    serviceInstanceId: app.id,
    userId,
    backendType: app.backendType,
    configFingerprint: app.fingerprint,
  };
}

export function publicInputFile({ id, name, size, type }: AgentInputFile) {
  return { id, name, size, type };
}

export function messageInputFile(file: AgentInputFile) {
  return {
    ...publicInputFile(file),
    slotKey: file.slotKey,
  };
}

export async function registerAgentInputFile(
  scope: InputFileScope,
  file: AgentInputFile
) {
  const rows = await queryRowsWithPgSystemContext<{ id: string }>(
    `INSERT INTO agent_input_files
      (id, user_id, service_instance_id, backend_type, config_fingerprint,
       native_file_id, slot_key, name, byte_size, mime_type)
      SELECT $5::uuid, $2::uuid, si.id, $3, $4, $6, $7, $8, $9, $10
      FROM service_instances si JOIN providers p ON p.id = si.provider_id AND p.is_active
      WHERE si.id = $1::uuid AND ${AGENT_APP_VISIBILITY_SQL}
      RETURNING id`,
    [
      scope.serviceInstanceId,
      scope.userId,
      scope.backendType ?? 'langchain',
      scope.configFingerprint,
      file.id,
      file.nativeId,
      file.slotKey,
      file.name,
      file.size,
      file.type,
    ]
  );
  if (!rows[0]) throw new AgentPolicyError(404, 'AGENT_APP_NOT_FOUND');
}

export async function loadAgentInputFiles(
  scope: InputFileScope,
  fileIds: string[],
  client?: PoolClient
): Promise<AgentInputFile[]> {
  const query = `SELECT f.id, f.native_file_id AS "nativeId", f.slot_key AS "slotKey",
      f.name, f.byte_size AS size, f.mime_type AS type
    FROM agent_input_files f
    JOIN service_instances si ON si.id = f.service_instance_id
    JOIN providers p ON p.id = si.provider_id AND p.is_active
    WHERE si.id = $1::uuid AND f.user_id = $2::uuid AND ${AGENT_APP_VISIBILITY_SQL}
      AND f.backend_type = $3 AND f.config_fingerprint = $4 AND f.id = ANY($5::uuid[])
      AND (NOT f.bound_once OR EXISTS (
        SELECT 1 FROM agent_input_file_messages binding
        JOIN messages m ON m.id = binding.message_id
        JOIN conversations c ON c.id = m.conversation_id
        JOIN backend_conversations b ON b.conversation_id = c.id
        WHERE binding.file_id = f.id AND m.user_id = f.user_id AND m.role = 'user'
          AND c.user_id = f.user_id AND c.status = 'active'
          AND b.service_instance_id = f.service_instance_id
          AND b.backend_type = f.backend_type AND b.config_fingerprint = f.config_fingerprint
          AND COALESCE(m.metadata->>'edit_hidden', 'false') <> 'true'
      ))
    ORDER BY f.id ${client ? 'FOR UPDATE OF f' : ''}`;
  const values = [
    scope.serviceInstanceId,
    scope.userId,
    scope.backendType ?? 'langchain',
    scope.configFingerprint,
    fileIds,
  ];
  return client
    ? (await client.query<AgentInputFile>(query, values)).rows
    : queryRowsWithPgSystemContext<AgentInputFile>(query, values);
}

export async function resolveAgentInputFiles(
  scope: InputFileScope,
  refs: AgentInputFileReference[],
  client?: PoolClient
) {
  if (!refs.length) return [];
  const found = await loadAgentInputFiles(
    scope,
    refs.map(ref => ref.fileId),
    client
  );
  const files = new Map(found.map(file => [file.id, file]));
  return refs.map(ref => {
    const file = files.get(ref.fileId);
    if (!file) throw new AgentPolicyError(404, 'INPUT_FILE_NOT_FOUND');
    if (file.slotKey !== ref.slotKey)
      throw new AgentPolicyError(400, 'INPUT_FILE_SLOT_INVALID');
    return file;
  });
}

export async function bindAgentInputFiles(
  client: PoolClient,
  messageId: string,
  files: AgentInputFile[]
) {
  if (!files.length) return;
  const ids = files.map(file => file.id);
  await client.query(
    `INSERT INTO agent_input_file_messages (file_id, message_id)
      SELECT file_id, $1::uuid FROM unnest($2::uuid[]) AS refs(file_id)`,
    [messageId, ids]
  );
  await client.query(
    `UPDATE agent_input_files SET bound_once = TRUE
      WHERE id = ANY($1::uuid[]) AND NOT bound_once`,
    [ids]
  );
}
