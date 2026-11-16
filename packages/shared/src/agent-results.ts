export const PUBLIC_RESULT_SCHEMA_VERSION = 1 as const;

export interface AgentResultArtifact {
  artifactId: string;
  filename: string;
  mediaType: 'text/markdown' | 'text/csv';
  sizeBytes: number;
  sha256: string;
}

export interface AgentResultSource {
  sourceId: string;
  title: string;
  excerpt: string;
}

export interface PublicAgentDeliverables {
  schemaVersion: typeof PUBLIC_RESULT_SCHEMA_VERSION;
  executionStatus:
    'pending' | 'running' | 'success' | 'error' | 'timeout' | 'interrupted';
  resultStatus: 'pending' | 'ready' | 'unavailable';
  reason: string | null;
  artifacts: AgentResultArtifact[];
  sources: AgentResultSource[];
}
