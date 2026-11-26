import type { FastifyReply, FastifyRequest } from 'fastify';

import { AgentPolicyError } from '../../lib/agent-backends';
import { queryRowsWithPgUserContext } from '../../lib/pg-context';
import { readDifySignedFile, sendDifyFileStream } from './file-preview';
import { isObjectRecord } from './helpers';
import type { DifyProxyRequestContext, DifyProxyTargetConfig } from './types';

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const toolKey =
  /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.[a-z0-9]{1,12}$/i;

function isNativeChat(target: DifyProxyTargetConfig) {
  return (
    !target.tempConfigUsed &&
    Boolean(target.serviceInstanceId) &&
    ['chatbot', 'agent', 'chatflow'].includes(
      target.appType?.toLowerCase() ?? ''
    )
  );
}

function toolFiles(entry: Record<string, unknown>) {
  if (!Array.isArray(entry.message_files)) return [];
  return entry.message_files.flatMap((file, index) => {
    if (
      !isObjectRecord(file) ||
      file.belongs_to !== 'assistant' ||
      file.transfer_method !== 'tool_file' ||
      typeof file.url !== 'string'
    )
      return [];
    try {
      const url = new URL(file.url, 'http://relative.invalid');
      if (
        !['http:', 'https:'].includes(url.protocol) ||
        url.username ||
        url.password
      )
        return [];
      const key = /\/files\/tools\/([^/]+)$/.exec(url.pathname)?.[1];
      if (
        !key ||
        !toolKey.test(key) ||
        file.upload_file_id !== key.split('.')[0] ||
        !['timestamp', 'nonce', 'sign'].every(name =>
          url.searchParams.get(name)
        )
      )
        return [];
      const name =
        typeof file.filename === 'string' &&
        file.filename.length <= 255 &&
        !file.filename.includes('/') &&
        !file.filename.includes('\\') &&
        file.filename.trim()
          ? file.filename
          : key;
      const size =
        typeof file.size === 'number' &&
        Number.isSafeInteger(file.size) &&
        file.size > 0
          ? file.size
          : 0;
      return [
        {
          index,
          key,
          url: url.toString(),
          image: file.type === 'image',
          name,
          size,
        },
      ];
    } catch {
      return [];
    }
  });
}

export function projectDifyResultFiles(
  value: unknown,
  target: DifyProxyTargetConfig
) {
  if (
    !isNativeChat(target) ||
    !isObjectRecord(value) ||
    !Array.isArray(value.data)
  )
    return value;
  return {
    ...value,
    data: value.data.map(entry => {
      if (!isObjectRecord(entry)) return entry;
      const files = toolFiles(entry);
      if (!files.length) return entry;
      const keys = new Map(
        files.map(({ key, image, name, size }) => [
          key,
          { key, image, name, size },
        ])
      );
      const projectedIndexes = new Set(files.map(file => file.index));
      return {
        ...entry,
        message_files: (entry.message_files as unknown[]).filter(
          (_, index) => !projectedIndexes.has(index)
        ),
        result_files: [...keys.values()],
      };
    }),
  };
}

async function loadVisibleMessage(
  context: DifyProxyRequestContext,
  target: DifyProxyTargetConfig,
  messageId: string
) {
  const [row] = await queryRowsWithPgUserContext<{
    message_external_id: string;
    conversation_external_id: string;
  }>(
    context.actor.userId,
    context.actor.role,
    `SELECT m.external_id AS message_external_id, c.external_id AS conversation_external_id
     FROM messages m JOIN conversations c ON c.id=m.conversation_id
     WHERE m.id=$1::uuid AND c.user_id=$2::uuid
       AND m.role='assistant' AND c.status='active' AND c.app_id::text=ANY($3::text[])
       AND COALESCE(m.metadata->>'edit_hidden','false')<>'true'
       AND COALESCE(m.metadata->>'edit_pending','false')<>'true'
       AND m.external_id IS NOT NULL AND c.external_id IS NOT NULL`,
    [
      messageId,
      context.actor.userId,
      [context.appId, target.serviceInstanceId, target.appInstanceId].filter(
        Boolean
      ),
    ]
  );
  return row;
}

async function resolveResultLink(
  context: DifyProxyRequestContext,
  target: DifyProxyTargetConfig,
  row: NonNullable<Awaited<ReturnType<typeof loadVisibleMessage>>>,
  key: string
) {
  const signal = AbortSignal.timeout(30000);
  const cursors = new Set<string>();
  const query = new URLSearchParams({
    conversation_id: row.conversation_external_id,
    user: context.actor.userId,
    limit: '100',
  });
  for (let page = 0; page < 20; page += 1) {
    const response = await fetch(
      `${target.difyApiUrl.replace(/\/+$/, '')}/messages?${query}`,
      {
        headers: { Authorization: `Bearer ${target.difyApiKey}` },
        redirect: 'error',
        cache: 'no-store',
        signal,
      }
    ).catch(() => {
      throw new AgentPolicyError(502, 'DIFY_FILE_REFRESH_FAILED');
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 404) return null;
      throw new AgentPolicyError(502, 'DIFY_FILE_REFRESH_FAILED');
    }
    const payload: unknown = await response.json().catch(() => null);
    if (!isObjectRecord(payload) || !Array.isArray(payload.data))
      throw new AgentPolicyError(502, 'DIFY_FILE_REFRESH_FAILED');
    const entry = payload.data.find(
      item =>
        isObjectRecord(item) &&
        item.id === row.message_external_id &&
        item.conversation_id === row.conversation_external_id
    );
    if (entry)
      return toolFiles(entry).find(file => file.key === key)?.url ?? null;
    const last: unknown = payload.data.at(-1);
    if (
      payload.has_more !== true ||
      !isObjectRecord(last) ||
      typeof last.id !== 'string' ||
      cursors.has(last.id)
    )
      return null;
    cursors.add(last.id);
    query.set('first_id', last.id);
  }
  throw new AgentPolicyError(503, 'DIFY_FILE_REFRESH_LIMIT');
}

export async function handleDifyResultFile(
  request: FastifyRequest,
  reply: FastifyReply,
  context: DifyProxyRequestContext,
  target: DifyProxyTargetConfig
): Promise<boolean> {
  const [resource, messageId, key] = context.slug;
  if (resource !== 'result-files') return false;
  if (
    request.method !== 'GET' ||
    context.slug.length !== 3 ||
    !uuid.test(messageId) ||
    !toolKey.test(key) ||
    !isNativeChat(target)
  )
    throw new AgentPolicyError(404, 'DIFY_FILE_NOT_FOUND');
  const row = await loadVisibleMessage(context, target, messageId);
  if (!row) throw new AgentPolicyError(404, 'DIFY_FILE_NOT_FOUND');
  const url = await resolveResultLink(context, target, row, key);
  if (!url) throw new AgentPolicyError(404, 'DIFY_FILE_NOT_FOUND');
  const file = await readDifySignedFile(target, `/files/tools/${key}`, url);
  if (!file) throw new AgentPolicyError(410, 'DIFY_FILE_PREVIEW_EXPIRED');
  try {
    const current = await loadVisibleMessage(context, target, messageId);
    if (
      current?.conversation_external_id !== row.conversation_external_id ||
      current?.message_external_id !== row.message_external_id
    )
      throw new AgentPolicyError(404, 'DIFY_FILE_NOT_FOUND');
  } catch (error) {
    await file.body.cancel().catch(() => undefined);
    throw error;
  }
  await sendDifyFileStream(reply, file);
  return true;
}
