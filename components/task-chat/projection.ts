import type { AppExecution } from '@lib/types/database';

export function mergeTaskExecutions(
  existing: AppExecution[],
  incoming: AppExecution[]
): AppExecution[] {
  const records = new Map(existing.map(execution => [execution.id, execution]));
  for (const execution of incoming) {
    const prior = records.get(execution.id);
    if (prior) {
      const previousTime = Date.parse(prior.updated_at || prior.created_at);
      const nextTime = Date.parse(execution.updated_at || execution.created_at);
      if (previousTime > nextTime) continue;
      if (
        previousTime === nextTime &&
        !['pending', 'running'].includes(prior.status) &&
        ['pending', 'running'].includes(execution.status)
      )
        continue;
    }
    records.set(execution.id, execution);
  }
  return [...records.values()].sort(
    (left, right) =>
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id)
  );
}

export function taskInputText(inputs: Record<string, unknown>): string {
  return Object.entries(inputs)
    .flatMap(([key, value]) => {
      if (value == null || value === '' || typeof value === 'object') return [];
      return [`${key}: ${String(value)}`];
    })
    .join('\n');
}

export function taskOutputText(
  outputs: Record<string, unknown> | null
): string {
  if (!outputs) return '';
  if (typeof outputs.generated_text === 'string') return outputs.generated_text;
  return Object.entries(outputs)
    .flatMap(([key, value]) =>
      typeof value === 'string' ? [`${key}:\n${value}`] : []
    )
    .join('\n\n');
}

export function hasDetailedTaskResult(
  outputs: Record<string, unknown> | null
): boolean {
  if (!outputs) return false;
  const values = Object.values(outputs);
  return values.length > 1 || values.some(value => typeof value !== 'string');
}
