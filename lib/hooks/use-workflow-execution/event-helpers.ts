import type { DifyWorkflowSseEvent } from '@lib/services/dify/types';

import type { WorkflowNodeEvent, WorkflowNodeSnapshot } from './types';

export function buildNormalizedWorkflowInputs(
  formData: Record<string, unknown>
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {};

  Object.entries(formData).forEach(([rawKey, value]) => {
    const key = rawKey.trim();
    if (!key || typeof value === 'undefined') {
      return;
    }

    normalized[key] = value;

    const lowerKey = key.toLowerCase();
    if (lowerKey !== key && !(lowerKey in normalized)) {
      normalized[lowerKey] = value;
    }
  });

  return normalized;
}

export function isWorkflowNodeEvent(
  event: DifyWorkflowSseEvent
): event is WorkflowNodeEvent {
  if (!('data' in event)) {
    return false;
  }

  const { data } = event;
  return (
    typeof data === 'object' &&
    data !== null &&
    'node_id' in data &&
    typeof data.node_id === 'string'
  );
}

export function upsertWorkflowNodeSnapshot(
  nodeExecutionData: WorkflowNodeSnapshot[],
  nodeData: WorkflowNodeSnapshot
): WorkflowNodeSnapshot[] {
  const existingNodeIndex = nodeExecutionData.findIndex(
    node => node.node_id === nodeData.node_id
  );

  if (existingNodeIndex < 0) {
    return [...nodeExecutionData, nodeData];
  }

  return nodeExecutionData.map((node, index) =>
    index === existingNodeIndex ? { ...node, ...nodeData } : node
  );
}
