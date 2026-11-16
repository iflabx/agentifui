import {
  type AgentResultSource,
  PUBLIC_RESULT_SCHEMA_VERSION,
  type PublicAgentDeliverables,
  type AgentResultArtifact as PublicAgentResultArtifact,
} from '@agentifui/shared';

export type {
  AgentResultSource,
  PublicAgentDeliverables,
} from '@agentifui/shared';
export { PUBLIC_RESULT_SCHEMA_VERSION } from '@agentifui/shared';

export const PHASE4_RESULT_PROFILE = 'phase4.result.v1';
export const MAX_RESULT_MANIFEST_BYTES = 32 * 1024;
export const MAX_RESULT_ARTIFACT_BYTES = 128 * 1024;

const ID_PATTERN = /^[A-Za-z0-9_-]{1,255}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REASONS = new Set([
  'run_in_progress',
  'run_not_successful',
  'not_published',
  'bridge_scope_missing',
  'not_published_for_run',
]);

export interface AgentResultArtifact extends PublicAgentResultArtifact {
  artifactId: 'report' | 'data';
  filename: 'report.md' | 'data.csv';
}

export interface AgentDeliverables {
  profile: typeof PHASE4_RESULT_PROFILE;
  threadId: string;
  runId: string;
  executionStatus: PublicAgentDeliverables['executionStatus'];
  resultStatus: PublicAgentDeliverables['resultStatus'];
  reason: string | null;
  artifacts: AgentResultArtifact[];
  sources: AgentResultSource[];
}

export function publicAgentDeliverables(
  value: AgentDeliverables
): PublicAgentDeliverables {
  return {
    schemaVersion: PUBLIC_RESULT_SCHEMA_VERSION,
    executionStatus: value.executionStatus,
    resultStatus: value.resultStatus,
    reason: value.reason,
    artifacts: value.artifacts,
    sources: value.sources,
  };
}

export function parseStoredAgentDeliverables(
  value: unknown
): AgentDeliverables {
  const source = record(value);
  return parseAgentDeliverables({
    profile: source.profile,
    thread_id: source.threadId,
    run_id: source.runId,
    execution_status: source.executionStatus,
    result_status: source.resultStatus,
    reason: source.reason,
    artifacts: Array.isArray(source.artifacts)
      ? source.artifacts.map(raw => {
          const item = record(raw);
          return {
            artifact_id: item.artifactId,
            filename: item.filename,
            media_type: item.mediaType,
            size_bytes: item.sizeBytes,
            sha256: item.sha256,
          };
        })
      : source.artifacts,
    sources: Array.isArray(source.sources)
      ? source.sources.map(raw => {
          const item = record(raw);
          return {
            source_id: item.sourceId,
            title: item.title,
            excerpt: item.excerpt,
          };
        })
      : source.sources,
  });
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(value: unknown, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max)
    throw new Error('invalid result manifest');
  return value;
}

function resultId(value: unknown): string {
  const id = requiredString(value, 255);
  if (!ID_PATTERN.test(id)) throw new Error('invalid result identifier');
  return id;
}

function jsonbText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(', ')}]`;
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .map(([key, item]) => `${JSON.stringify(key)}: ${jsonbText(item)}`)
      .join(', ')}}`;
  return JSON.stringify(value);
}

export function parseAgentDeliverables(value: unknown): AgentDeliverables {
  const source = record(value);
  if (source.profile !== PHASE4_RESULT_PROFILE)
    throw new Error('unsupported result profile');
  const executionStatus = source.execution_status;
  if (
    ![
      'pending',
      'running',
      'success',
      'error',
      'timeout',
      'interrupted',
    ].includes(String(executionStatus))
  )
    throw new Error('invalid execution status');
  const resultStatus = source.result_status;
  if (!['pending', 'ready', 'unavailable'].includes(String(resultStatus)))
    throw new Error('invalid result status');
  const reason = source.reason;
  if (
    reason !== null &&
    (typeof reason !== 'string' || reason.length === 0 || !REASONS.has(reason))
  )
    throw new Error('invalid result reason');
  const rawArtifacts = source.artifacts;
  if (!Array.isArray(rawArtifacts) || rawArtifacts.length > 2)
    throw new Error('invalid result artifacts');
  const artifactIds = new Set<string>();
  const artifacts = rawArtifacts.map(raw => {
    const item = record(raw);
    const artifactId = item.artifact_id;
    const filename = item.filename;
    const mediaType = item.media_type;
    const sizeBytes = item.size_bytes;
    const sha256 = item.sha256;
    if (
      (artifactId !== 'report' && artifactId !== 'data') ||
      artifactIds.has(String(artifactId)) ||
      (filename !== 'report.md' && filename !== 'data.csv') ||
      (mediaType !== 'text/markdown' && mediaType !== 'text/csv') ||
      !Number.isSafeInteger(sizeBytes) ||
      Number(sizeBytes) < 0 ||
      Number(sizeBytes) > MAX_RESULT_ARTIFACT_BYTES ||
      typeof sha256 !== 'string' ||
      !SHA256_PATTERN.test(sha256)
    )
      throw new Error('invalid result artifact');
    if (
      (artifactId === 'report' &&
        (filename !== 'report.md' || mediaType !== 'text/markdown')) ||
      (artifactId === 'data' &&
        (filename !== 'data.csv' || mediaType !== 'text/csv'))
    )
      throw new Error('invalid result artifact mapping');
    artifactIds.add(artifactId);
    return {
      artifactId: artifactId as AgentResultArtifact['artifactId'],
      filename: filename as AgentResultArtifact['filename'],
      mediaType: mediaType as AgentResultArtifact['mediaType'],
      sizeBytes: sizeBytes as number,
      sha256,
    };
  });
  const rawSources = source.sources;
  if (!Array.isArray(rawSources) || rawSources.length > 10)
    throw new Error('invalid result sources');
  const sources = rawSources.map(raw => {
    const item = record(raw);
    const excerpt = requiredString(item.excerpt, 2048);
    if (Buffer.byteLength(excerpt, 'utf8') > 2048)
      throw new Error('result source excerpt too large');
    return {
      sourceId: requiredString(item.source_id, 128),
      title: requiredString(item.title, 512),
      excerpt,
    };
  });
  const manifest: AgentDeliverables = {
    profile: PHASE4_RESULT_PROFILE,
    threadId: resultId(source.thread_id),
    runId: resultId(source.run_id),
    executionStatus: executionStatus as AgentDeliverables['executionStatus'],
    resultStatus: resultStatus as AgentDeliverables['resultStatus'],
    reason: reason as string | null,
    artifacts,
    sources,
  };
  if (
    manifest.resultStatus === 'ready' &&
    (manifest.executionStatus !== 'success' ||
      !manifest.artifacts.length ||
      manifest.reason !== null)
  )
    throw new Error('ready result must contain artifacts');
  if (
    manifest.resultStatus !== 'ready' &&
    (manifest.artifacts.length > 0 || manifest.reason === null)
  )
    throw new Error('unready result must contain a reason and no artifacts');
  if (
    Buffer.byteLength(jsonbText(manifest), 'utf8') > MAX_RESULT_MANIFEST_BYTES
  )
    throw new Error('result manifest too large');
  return manifest;
}
