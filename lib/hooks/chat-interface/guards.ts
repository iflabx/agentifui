import type { ChatSubmitResult } from './types';

export function isChatSubmitResult(value: unknown): value is ChatSubmitResult {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    'ok' in (value as Record<string, unknown>)
  );
}
