import type { DifyWorkflowSseEvent } from '@lib/services/dify/types';

export type WorkflowNodeEvent = Extract<
  DifyWorkflowSseEvent,
  { data: { node_id: string } }
>;

export type WorkflowNodeSnapshot = {
  node_id: string;
  node_type?: string;
  title?: string;
  status?: 'running' | 'succeeded' | 'failed' | 'stopped';
  inputs?: Record<string, unknown>;
  outputs?: unknown;
  process_data?: unknown;
  execution_metadata?: unknown;
  elapsed_time?: number;
  total_tokens?: number;
  total_price?: string;
  currency?: string;
  error?: string | null;
  created_at?: number;
  index?: number;
  predecessor_node_id?: string;
  event_type: WorkflowNodeEvent['event'];
};
