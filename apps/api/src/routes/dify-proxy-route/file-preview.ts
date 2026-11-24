import type { FastifyReply, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';

import { AgentPolicyError } from '../../lib/agent-backends';
import { agentUploadBodyLimit } from '../../lib/agent-input';
import {
  canReadDifyUpload,
  hasDifyUploadReference,
  registerDifyUpload,
} from '../../lib/dify-upload-access';
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
  const workflow = target.appType?.trim().toLowerCase() === 'workflow';
  if (!target.serviceInstanceId || target.tempConfigUsed) return upstream;
  const file = form.get('file');
  const data = await upstream.json();
  if (
    !(file instanceof Blob) ||
    typeof data?.id !== 'string' ||
    !target.serviceInstanceId
  ) {
    throw new AgentPolicyError(502, 'DIFY_UPLOAD_RESPONSE_INVALID');
  }
  try {
    const scope = {
      userId: context.actor.userId,
      serviceInstanceId: target.serviceInstanceId,
      fileId: data.id,
    };
    if (workflow) await saveDifyUpload(scope, file);
    await registerDifyUpload(scope, false, {
      name: file instanceof File ? file.name : String(data.name || ''),
      size: file.size,
      type: file.type,
    });
  } catch {
    throw new AgentPolicyError(503, 'DIFY_UPLOAD_STORAGE_UNAVAILABLE');
  }
  const headers = new Headers(upstream.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  delete data.source_url;
  delete data.url;
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

async function readConversationFile(
  target: DifyProxyTargetConfig,
  fileId: string,
  signedUrl: string
) {
  const signature = new URL(signedUrl).searchParams;
  const fileUrl = new URL(target.difyApiUrl);
  const prefix = fileUrl.pathname.replace(/\/+$/, '').replace(/\/v1$/, '');
  fileUrl.pathname = `${prefix}/files/${encodeURIComponent(fileId)}/file-preview`;
  fileUrl.search = '';
  fileUrl.hash = '';
  for (const name of ['timestamp', 'nonce', 'sign']) {
    const value = signature.get(name);
    if (value) fileUrl.searchParams.set(name, value);
  }
  if (!fileUrl.searchParams.has('sign')) return null;

  const response = await fetch(fileUrl, {
    redirect: 'error',
    cache: 'no-store',
    signal: AbortSignal.timeout(30000),
  }).catch(() => {
    throw new AgentPolicyError(502, 'DIFY_FILE_READ_FAILED');
  });
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    if ([404, 410].includes(response.status)) return null;
    throw new AgentPolicyError(502, 'DIFY_FILE_READ_FAILED');
  }
  const limit = agentUploadBodyLimit();
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null && Number(contentLength) > limit) {
    await response.body.cancel().catch(() => undefined);
    throw new AgentPolicyError(502, 'DIFY_FILE_READ_FAILED');
  }
  return {
    body: response.body,
    contentType: response.headers.get('content-type'),
    limit,
  };
}

async function* boundedFileBytes(
  body: ReadableStream<Uint8Array>,
  limit: number
) {
  const reader = body.getReader();
  let bytes = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) return;
      bytes += chunk.value.byteLength;
      if (bytes > limit) throw new Error('DIFY_FILE_READ_FAILED');
      yield chunk.value;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function fileReply(reply: FastifyReply, contentType: string | null) {
  const activeType =
    /^(?:text\/(?:html|xml)|application\/(?:xhtml\+xml|xml)|image\/svg\+xml)(?:[\s;]|$)/i.test(
      contentType?.trim() ?? ''
    );
  return reply
    .header('Cache-Control', 'private, no-store')
    .header('X-Content-Type-Options', 'nosniff')
    .header('Content-Security-Policy', "default-src 'none'; sandbox")
    .header('Content-Disposition', 'attachment; filename="attachment"')
    .header(
      'Content-Type',
      activeType || !contentType ? 'application/octet-stream' : contentType
    );
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
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(fileId)) {
    throw new AgentPolicyError(400, 'DIFY_FILE_CONTEXT_INVALID');
  }

  const scope = {
    userId: context.actor.userId,
    serviceInstanceId: target.serviceInstanceId,
    fileId,
  };
  const query = new URL(request.url, 'http://preview.invalid').searchParams;
  const reference = {
    conversationId: query.get('conversation_id') || undefined,
    executionId: query.get('execution_id') || undefined,
  };
  if (
    Object.values(reference).some(
      value =>
        value &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          value
        )
    )
  )
    throw new AgentPolicyError(400, 'DIFY_FILE_CONTEXT_INVALID');
  const registered = await canReadDifyUpload(scope, reference);
  if (!registered && !(await hasDifyUploadReference(scope, reference)))
    throw new AgentPolicyError(404, 'DIFY_FILE_NOT_FOUND');

  const confirmLegacyOwnership = async () => {
    if (!registered) await registerDifyUpload(scope, true);
    if (!(await canReadDifyUpload(scope, reference)))
      throw new AgentPolicyError(404, 'DIFY_FILE_NOT_FOUND');
  };

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
    await confirmLegacyOwnership();
    fileReply(reply, archived.contentType).send(archived.content);
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
     WHERE c.user_id = $1::uuid AND m.user_id = $1::uuid AND m.role = 'user' AND c.status='active'
       AND c.app_id::text = ANY($2::text[])
       AND $5::uuid IS NULL AND ($4::uuid IS NULL OR c.id=$4::uuid)
       AND m.metadata @> $3::jsonb
     LIMIT 1`,
    [
      context.actor.userId,
      appIds,
      JSON.stringify({ attachments: [{ upload_file_id: fileId }] }),
      reference.conversationId || null,
      reference.executionId || null,
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
      const file = await readConversationFile(target, fileId, url);
      if (file) {
        try {
          await confirmLegacyOwnership();
        } catch (error) {
          await file.body.cancel().catch(() => undefined);
          throw error;
        }
        fileReply(reply, file.contentType).send(
          Readable.from(boundedFileBytes(file.body, file.limit), {
            objectMode: false,
          })
        );
        await reply;
        return true;
      }
    }
  }

  if (!registered) throw new AgentPolicyError(404, 'DIFY_FILE_NOT_FOUND');

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
