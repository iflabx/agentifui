import type { AgentErrorSource } from '../../lib/agent-error';

export interface DifyProxyActor {
  userId: string;
  role: string;
}

export interface DifyTempConfig {
  apiUrl: string;
  apiKey: string;
}

export interface DifyProxyRequestContext {
  appId: string;
  slug: string[];
  routePath: string;
  requestLocale?: string;
  actor: DifyProxyActor;
}

export interface DifyProxyTargetConfig {
  difyApiKey: string;
  difyApiUrl: string;
  appType?: string;
  tempConfigUsed: boolean;
  rawBody: unknown;
}

export interface LogDifyProxyFailureInput {
  appId: string;
  routePath: string;
  slugPath: string;
  agentSource: AgentErrorSource;
  failureKind: string;
  level?: 'warn' | 'error';
  upstreamStatus?: number;
  upstreamContentType?: string;
  upstreamErrorCode?: string | null;
  responseBody?: string;
  retryAfterSeconds?: number;
  elapsedMs?: number;
  error?: unknown;
}

export interface SendUpstreamStreamOptions {
  allow: (key: string) => boolean;
  appId: string;
  routePath: string;
  slugPath: string;
  streamKind: 'sse' | 'media';
  defaultHeaders?: Record<string, string>;
  requestStartedAt: number;
  responseHeaderElapsedMs: number;
  targetHost: string;
  targetOrigin: string;
}
