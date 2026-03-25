import type { DifyMessageFile } from './messages';
import type { DifyRetrieverResource, DifyUsage } from './shared';

interface DifySseBaseEvent {
  task_id: string;
  id?: string;
  conversation_id: string;
  event: string;
}

export interface DifySseMessageEvent extends DifySseBaseEvent {
  event: 'message';
  id: string;
  answer: string;
  created_at: number;
}

export interface DifySseMessageFileEvent extends DifySseBaseEvent {
  event: 'message_file';
  id: string;
  type: string;
  belongs_to: 'user' | 'assistant';
  url: string;
}

export interface DifySseMessageEndEvent extends DifySseBaseEvent {
  event: 'message_end';
  id: string;
  metadata: Record<string, unknown>;
  usage: DifyUsage;
  retriever_resources?: DifyRetrieverResource[];
}

export interface DifySseTtsMessageEvent extends DifySseBaseEvent {
  event: 'tts_message';
  id: string;
  audio: string;
  created_at: number;
}

export interface DifySseTtsMessageEndEvent extends DifySseBaseEvent {
  event: 'tts_message_end';
  id: string;
  audio: string;
  created_at: number;
}

export interface DifySseMessageReplaceEvent extends DifySseBaseEvent {
  event: 'message_replace';
  id: string;
  answer: string;
  created_at: number;
}

export interface DifySseWorkflowStartedEvent extends DifySseBaseEvent {
  event: 'workflow_started';
  workflow_run_id: string;
  data: {
    id: string;
    workflow_id: string;
    sequence_number: number;
    created_at: number;
  };
}

export interface DifySseNodeStartedEvent extends DifySseBaseEvent {
  event: 'node_started';
  workflow_run_id: string;
  data: {
    id: string;
    node_id: string;
    node_type: string;
    title: string;
    index: number;
    predecessor_node_id?: string;
    inputs: Record<string, unknown>;
    created_at: number;
  };
}

export interface DifySseNodeFinishedEvent extends DifySseBaseEvent {
  event: 'node_finished';
  workflow_run_id: string;
  data: {
    id: string;
    node_id: string;
    index: number;
    predecessor_node_id?: string;
    inputs?: Record<string, unknown>;
    process_data?: unknown;
    outputs?: unknown;
    status: 'running' | 'succeeded' | 'failed' | 'stopped';
    error?: string;
    elapsed_time?: number;
    execution_metadata?: unknown;
    total_tokens?: number;
    total_price?: string;
    currency?: string;
    created_at: number;
  };
}

export interface DifySseWorkflowFinishedEvent extends DifySseBaseEvent {
  event: 'workflow_finished';
  workflow_run_id: string;
  data: {
    id: string;
    workflow_id: string;
    status: 'running' | 'succeeded' | 'failed' | 'stopped';
    outputs?: unknown;
    error?: string;
    elapsed_time?: number;
    total_tokens?: number;
    total_steps: number;
    created_at: number;
    finished_at: number;
  };
}

export interface DifySseErrorEvent extends DifySseBaseEvent {
  event: 'error';
  id?: string;
  status: number;
  code: string;
  message: string;
}

export interface DifySsePingEvent extends DifySseBaseEvent {
  event: 'ping';
}

export interface DifySseAgentThoughtEvent extends DifySseBaseEvent {
  event: 'agent_thought';
  id: string;
  message_id: string;
  position: number;
  thought: string;
  observation: string;
  tool: string;
  tool_labels: Record<string, unknown>;
  tool_input: string;
  message_files: DifyMessageFile[];
  created_at: number;
}

export interface DifySseAgentMessageEvent extends DifySseBaseEvent {
  event: 'agent_message';
  id: string;
  message_id: string;
  answer: string;
  created_at: number;
}

export interface DifySseIterationStartedEvent extends DifySseBaseEvent {
  event: 'iteration_started';
  workflow_run_id: string;
  data: {
    id: string;
    node_id: string;
    node_type: string;
    title: string;
    iteration_id: string;
    iteration_index: number;
    total_iterations?: number;
    inputs: Record<string, unknown>;
    created_at: number;
  };
}

export interface DifySseIterationNextEvent extends DifySseBaseEvent {
  event: 'iteration_next';
  workflow_run_id: string;
  data: {
    id: string;
    node_id: string;
    iteration_id: string;
    iteration_index: number;
    outputs?: Record<string, unknown>;
    created_at: number;
  };
}

export interface DifySseIterationCompletedEvent extends DifySseBaseEvent {
  event: 'iteration_completed';
  workflow_run_id: string;
  data: {
    id: string;
    node_id: string;
    iteration_id: string;
    total_iterations: number;
    outputs: Record<string, unknown>;
    elapsed_time: number;
    created_at: number;
  };
}

export interface DifySseParallelBranchStartedEvent extends DifySseBaseEvent {
  event: 'parallel_branch_started';
  workflow_run_id: string;
  data: {
    id: string;
    node_id: string;
    branch_id: string;
    branch_index: number;
    total_branches?: number;
    inputs: Record<string, unknown>;
    created_at: number;
  };
}

export interface DifySseParallelBranchFinishedEvent extends DifySseBaseEvent {
  event: 'parallel_branch_finished';
  workflow_run_id: string;
  data: {
    id: string;
    node_id: string;
    branch_id: string;
    branch_index: number;
    status: 'succeeded' | 'failed' | 'stopped';
    outputs?: Record<string, unknown>;
    error?: string;
    elapsed_time: number;
    created_at: number;
  };
}

export interface DifySseLoopStartedEvent extends DifySseBaseEvent {
  event: 'loop_started';
  workflow_run_id: string;
  data: {
    id: string;
    node_id: string;
    node_type: string;
    title: string;
    inputs: Record<string, unknown>;
    metadata?: { loop_length?: number };
    created_at: number;
  };
}

export interface DifySseLoopNextEvent extends DifySseBaseEvent {
  event: 'loop_next';
  workflow_run_id: string;
  data: {
    id: string;
    node_id: string;
    node_type: string;
    title: string;
    index: number;
    pre_loop_output?: Record<string, unknown>;
    created_at: number;
  };
}

export interface DifySseLoopCompletedEvent extends DifySseBaseEvent {
  event: 'loop_completed';
  workflow_run_id: string;
  data: {
    id: string;
    node_id: string;
    outputs?: Record<string, unknown>;
    elapsed_time?: number;
    created_at: number;
  };
}

export type DifySseEvent =
  | DifySseMessageEvent
  | DifySseMessageFileEvent
  | DifySseMessageEndEvent
  | DifySseTtsMessageEvent
  | DifySseTtsMessageEndEvent
  | DifySseMessageReplaceEvent
  | DifySseWorkflowStartedEvent
  | DifySseNodeStartedEvent
  | DifySseNodeFinishedEvent
  | DifySseWorkflowFinishedEvent
  | DifySseIterationStartedEvent
  | DifySseIterationNextEvent
  | DifySseIterationCompletedEvent
  | DifySseParallelBranchStartedEvent
  | DifySseParallelBranchFinishedEvent
  | DifySseLoopStartedEvent
  | DifySseLoopNextEvent
  | DifySseLoopCompletedEvent
  | DifySseErrorEvent
  | DifySsePingEvent
  | DifySseAgentThoughtEvent
  | DifySseAgentMessageEvent;
