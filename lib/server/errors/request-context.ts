import type { AppErrorSource } from '@lib/errors/app-error';
import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestErrorContext {
  requestId: string;
  source: AppErrorSource;
  route?: string;
  method?: string;
  actorUserId?: string;
}

const REQUEST_ERROR_CONTEXT = new AsyncLocalStorage<RequestErrorContext>();

export function runWithRequestErrorContext<T>(
  context: RequestErrorContext,
  operation: () => Promise<T>
): Promise<T> {
  return REQUEST_ERROR_CONTEXT.run(context, operation);
}

export function getRequestErrorContext(): RequestErrorContext | null {
  return REQUEST_ERROR_CONTEXT.getStore() || null;
}

export function updateRequestErrorContext(
  update: Partial<RequestErrorContext>
): void {
  const context = REQUEST_ERROR_CONTEXT.getStore();
  if (!context) {
    return;
  }
  Object.assign(context, update);
}
