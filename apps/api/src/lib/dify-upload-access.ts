import type { DifyUploadScope } from './dify-upload-archive';
import { queryRowsWithPgSystemContext } from './pg-context';

export async function registerDifyUpload(
  scope: DifyUploadScope,
  boundOnce = false,
  metadata?: { name: string; size: number; type: string }
): Promise<void> {
  await queryRowsWithPgSystemContext(
    `INSERT INTO dify_upload_access(user_id,service_instance_id,file_id,bound_once,file_name,byte_size,mime_type)
    VALUES($1::uuid,$2::uuid,$3,$4,$5,$6,$7) ON CONFLICT(user_id,service_instance_id,file_id)
    DO UPDATE SET bound_once=dify_upload_access.bound_once OR EXCLUDED.bound_once,
      file_name=COALESCE(dify_upload_access.file_name,EXCLUDED.file_name),
      byte_size=COALESCE(dify_upload_access.byte_size,EXCLUDED.byte_size),
      mime_type=COALESCE(dify_upload_access.mime_type,EXCLUDED.mime_type)`,
    [
      scope.userId,
      scope.serviceInstanceId,
      scope.fileId,
      boundOnce,
      metadata?.name ?? null,
      metadata?.size ?? null,
      metadata?.type ?? null,
    ]
  );
}

export async function loadDifyUploadMetadata(scope: DifyUploadScope): Promise<{
  name: string;
  size: number;
  type: string;
} | null> {
  if (!(await canReadDifyUpload(scope))) return null;
  const rows = await queryRowsWithPgSystemContext<{
    file_name: string | null;
    byte_size: string | number | null;
    mime_type: string | null;
  }>(
    `SELECT file_name,byte_size,mime_type FROM dify_upload_access
     WHERE user_id=$1::uuid AND service_instance_id=$2::uuid AND file_id=$3`,
    [scope.userId, scope.serviceInstanceId, scope.fileId]
  );
  const row = rows[0];
  if (!row?.file_name || row.byte_size === null) return null;
  return {
    name: row.file_name,
    size: Number(row.byte_size),
    type: row.mime_type || '',
  };
}

export async function canReadDifyUpload(
  scope: DifyUploadScope,
  resource: { conversationId?: string; executionId?: string } = {}
): Promise<boolean> {
  return checkDifyUploadAccess(scope, resource, true);
}

export async function hasDifyUploadReference(
  scope: DifyUploadScope,
  resource: { conversationId?: string; executionId?: string } = {}
): Promise<boolean> {
  return checkDifyUploadAccess(scope, resource, false);
}

async function checkDifyUploadAccess(
  scope: DifyUploadScope,
  resource: { conversationId?: string; executionId?: string },
  requireRegistration: boolean
): Promise<boolean> {
  const rows = await queryRowsWithPgSystemContext<{ allowed: boolean }>(
    `SELECT (
    EXISTS (SELECT 1 FROM conversations c JOIN messages m ON m.conversation_id=c.id
      JOIN service_instances si ON si.id=$2::uuid AND c.app_id IN(si.id::text,si.instance_id)
      WHERE c.user_id=$1::uuid AND m.user_id=$1::uuid AND m.role='user' AND c.status='active'
        AND $5::uuid IS NULL AND ($4::uuid IS NULL OR c.id=$4::uuid)
        AND $3 IN(SELECT dify_upload_file_ids(m.metadata)))
    OR EXISTS (SELECT 1 FROM app_executions e WHERE e.user_id=$1::uuid AND e.service_instance_id=$2::uuid
      AND e.status<>'deleted' AND ($4::uuid IS NULL OR e.conversation_id=$4::uuid) AND ($5::uuid IS NULL OR e.id=$5::uuid)
      AND (e.conversation_id IS NULL OR EXISTS (SELECT 1 FROM conversations execution_conversation
        WHERE execution_conversation.id=e.conversation_id AND execution_conversation.status='active'
          AND execution_conversation.user_id=$1::uuid AND execution_conversation.app_id=$2::text))
      AND $3 IN(SELECT dify_upload_file_ids(e.inputs)))
    OR ($6 AND $4::uuid IS NULL AND $5::uuid IS NULL AND EXISTS(SELECT 1 FROM dify_upload_access
      WHERE user_id=$1::uuid AND service_instance_id=$2::uuid AND file_id=$3 AND NOT bound_once))
    ) AND (NOT $6 OR EXISTS(SELECT 1 FROM dify_upload_access WHERE user_id=$1::uuid AND service_instance_id=$2::uuid AND file_id=$3))
    AND EXISTS(SELECT 1 FROM profiles actor JOIN service_instances si ON si.id=$2::uuid
      JOIN providers provider ON provider.id=si.provider_id AND provider.is_active
      WHERE actor.id=$1::uuid AND actor.status='active'
        AND (actor.role='admin' OR si.visibility='public' OR(si.visibility='group_only' AND EXISTS(
          SELECT 1 FROM group_app_permissions permission JOIN group_members member ON member.group_id=permission.group_id
          WHERE permission.service_instance_id=si.id AND permission.is_enabled AND member.user_id=actor.id)))) AS allowed`,
    [
      scope.userId,
      scope.serviceInstanceId,
      scope.fileId,
      resource.conversationId || null,
      resource.executionId || null,
      requireRegistration,
    ]
  );
  return rows[0]?.allowed === true;
}
