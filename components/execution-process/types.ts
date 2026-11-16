export type ExecutionProcessStatus =
  'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'unknown';

export interface ExecutionProcessItem {
  key: string;
  title: string;
  kind: 'step' | 'tool';
  status: ExecutionProcessStatus;
  durationMs?: number;
  children?: ExecutionProcessItem[];
}
