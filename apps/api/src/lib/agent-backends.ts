export type AgentBackendType = 'dify' | 'langchain';

export class AgentPolicyError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string
  ) {
    super(code);
  }
}

const BACKENDS = {
  dify: {
    persistence: 'browser',
    capabilities: {
      text: true,
      streaming: true,
      history: true,
      tools: false,
      runQuery: false,
      cancellation: true,
      files: true,
      humanInput: false,
      resumableStream: false,
    },
  },
  langchain: {
    persistence: 'server',
    capabilities: {
      text: true,
      streaming: true,
      history: true,
      tools: 'read-only-summary',
      runQuery: true,
      cancellation: false,
      files: false,
      humanInput: false,
      resumableStream: false,
    },
  },
} as const;

export function resolveBackendType(
  config: Record<string, unknown> | null | undefined
): AgentBackendType {
  const backend = config?.backend_type;
  if (backend === undefined || backend === 'dify') return 'dify';
  if (backend === 'langchain') return backend;
  throw new AgentPolicyError(409, 'AGENT_BACKEND_UNSUPPORTED');
}

export function describeBackend(
  config: Record<string, unknown> | null | undefined
) {
  const backendType = resolveBackendType(config);
  return { backendType, ...BACKENDS[backendType] };
}

export const LANGCHAIN_CAPABILITIES = BACKENDS.langchain.capabilities;

export function isDifyGeneration(method: string, path: string): boolean {
  return (
    method.toUpperCase() === 'POST' &&
    (path === 'chat-messages' ||
      path === 'completion-messages' ||
      path === 'workflows/run' ||
      /^workflows\/(?:[^/]+\/run|run\/[^/]+)$/.test(path))
  );
}
