import type { FastifyReply, FastifyRequest } from 'fastify';

import { AgentPolicyError } from '../../lib/agent-backends';
import { readDifyUpload, saveDifyUpload } from '../../lib/dify-upload-archive';
import { queryRowsWithPgUserContext } from '../../lib/pg-context';
import { buildRouteErrorPayload } from '../../lib/route-error';
import type { DifyProxyRequestContext, DifyProxyTargetConfig } from './types';

export async function archiveDifyUploadResponse(
  upstream: Response,
  form: FormData,
  context: DifyProxyRequestContext,
  target: DifyProxyTargetConfig
): Promise<Response> {
  if (target.appType?.trim().toLowerCase() !== 'workflow') return upstream;
  const file = form.get('file');
  const data = await upstream.json();
  if (
    !(file instanceof Blob) ||
    typeof data.id !== 'string' ||
    !target.serviceInstanceId
  ) {
    throw new AgentPolicyError(502, 'DIFY_UPLOAD_RESPONSE_INVALID');
  }
  try {
    await saveDifyUpload(
      {
        userId: context.actor.userId,
        serviceInstanceId: target.serviceInstanceId,
        fileId: data.id,
      },
      file
    );
  } catch {
    throw new AgentPolicyError(503, 'DIFY_UPLOAD_STORAGE_UNAVAILABLE');
  }
  const headers = new Headers(upstream.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(
    JSON.stringify({
      ...data,
      preview_url: `/api/dify/${encodeURIComponent(context.appId)}/files/${encodeURIComponent(data.id)}/preview`,
    }),
    { status: upstream.status, headers }
  );
}

export function findDifyFileUrl(
  value: unknown,
  fileId: string,
  depth = 0
): string | null {
  if (depth > 8 || !value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (
    (record.upload_file_id === fileId ||
      record.related_id === fileId ||
      (!record.upload_file_id &&
        !record.related_id &&
        record.belongs_to === 'user')) &&
    typeof record.url === 'string'
  ) {
    try {
      const url = new URL(record.url);
      if (
        ['https:', 'http:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        url.pathname.endsWith(
          `/files/${encodeURIComponent(fileId)}/file-preview`
        )
      ) {
        return url.toString();
      }
    } catch {}
  }
  for (const child of Object.values(value)) {
    const found = findDifyFileUrl(child, fileId, depth + 1);
    if (found) return found;
  }
  return null;
}

async function refreshConversationFileUrl(
  context: DifyProxyRequestContext,
  target: DifyProxyTargetConfig,
  conversationId: string,
  fileId: string
): Promise<string | null> {
  const signal = AbortSignal.timeout(30000);
  let firstId: string | undefined;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({
      conversation_id: conversationId,
      user: context.actor.userId,
      limit: '100',
    });
    if (firstId) query.set('first_id', firstId);
    const response = await fetch(
      `${target.difyApiUrl.replace(/\/+$/, '')}/messages?${query}`,
      {
        headers: { Authorization: `Bearer ${target.difyApiKey}` },
        redirect: 'error',
        cache: 'no-store',
        signal,
      }
    );
    if (!response.ok)
      throw new AgentPolicyError(502, 'DIFY_FILE_REFRESH_FAILED');
    const data = await response.json();
    if (!Array.isArray(data.data)) return null;
    const url = findDifyFileUrl(data.data, fileId);
    if (url) return url;
    const nextId = data.data.at(-1)?.id;
    if (!data.has_more || typeof nextId !== 'string' || nextId === firstId)
      return null;
    firstId = nextId;
  }
  throw new AgentPolicyError(503, 'DIFY_FILE_REFRESH_LIMIT');
}

export async function handleOwnedDifyFilePreview(
  request: FastifyRequest,
  reply: FastifyReply,
  context: DifyProxyRequestContext,
  target: DifyProxyTargetConfig
): Promise<boolean> {
  const [resource, fileId, action] = context.slug;
  if (
    request.method !== 'GET' ||
    context.slug.length !== 3 ||
    resource !== 'files' ||
    action !== 'preview' ||
    !target.serviceInstanceId ||
    target.tempConfigUsed
  ) {
    return false;
  }

  let archived: Awaited<ReturnType<typeof readDifyUpload>> = null;
  if (target.appType?.trim().toLowerCase() === 'workflow') {
    try {
      archived = await readDifyUpload({
        userId: context.actor.userId,
        serviceInstanceId: target.serviceInstanceId,
        fileId,
      });
    } catch {
      throw new AgentPolicyError(503, 'DIFY_UPLOAD_STORAGE_UNAVAILABLE');
    }
  }
  if (archived) {
    const activeType =
      /^(?:text\/(?:html|xml)|application\/(?:xhtml\+xml|xml)|image\/svg\+xml)(?:;|$)/i.test(
        archived.contentType
      );
    reply
      .header('Cache-Control', 'private, no-store')
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Content-Disposition', 'attachment; filename="attachment"')
      .header(
        'Content-Type',
        activeType ? 'application/octet-stream' : archived.contentType
      )
      .send(archived.content);
    return true;
  }

  const appIds = [
    context.appId,
    target.serviceInstanceId,
    target.appInstanceId,
  ].filter(Boolean);
  const rows = await queryRowsWithPgUserContext<{ external_id: string | null }>(
    context.actor.userId,
    context.actor.role,
    `SELECT c.external_id FROM conversations c
     JOIN messages m ON m.conversation_id = c.id
     WHERE c.user_id = $1::uuid AND m.user_id = $1::uuid AND m.role = 'user'
       AND c.app_id::text = ANY($2::text[])
       AND m.metadata @> $3::jsonb
     LIMIT 1`,
    [
      context.actor.userId,
      appIds,
      JSON.stringify({ attachments: [{ upload_file_id: fileId }] }),
    ]
  );
  if (rows[0]?.external_id) {
    const url = await refreshConversationFileUrl(
      context,
      target,
      rows[0].external_id,
      fileId
    );
    if (url) {
      reply
        .header('Cache-Control', 'private, no-store')
        .header('Location', url)
        .status(302)
        .send();
      return true;
    }
  }

  const executions = rows.length
    ? []
    : await queryRowsWithPgUserContext<{ id: string }>(
        context.actor.userId,
        context.actor.role,
        `SELECT id FROM app_executions
     WHERE user_id = $1::uuid AND service_instance_id::text = ANY($2::text[])
       AND jsonb_path_exists(inputs, '$.** ? (@.upload_file_id == $fileId)',
         jsonb_build_object('fileId', $3::text))
     LIMIT 1`,
        [context.actor.userId, appIds, fileId]
      );
  if (!rows.length && !executions.length) return false;
  reply.status(410).send(
    buildRouteErrorPayload({
      request,
      statusCode: 410,
      source: 'dify-proxy',
      code: 'DIFY_FILE_PREVIEW_EXPIRED',
      userMessage:
        'This legacy attachment has no retained original and its preview cannot be renewed. Please upload the original file again.',
    })
  );
  return true;
}
