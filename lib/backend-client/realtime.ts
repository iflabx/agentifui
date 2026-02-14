import {
  type SubscriptionConfig,
  SubscriptionConfigs,
  SubscriptionKeys,
  realtimeService,
} from '@lib/services/db/realtime-service';

export { SubscriptionConfigs, SubscriptionKeys };
export type { SubscriptionConfig };

export function subscribeRealtime(
  key: string,
  config: SubscriptionConfig,
  handler: (payload: unknown) => void
): () => void {
  return realtimeService.subscribe(key, config, handler);
}

export function unsubscribeRealtime(key: string): void {
  realtimeService.unsubscribe(key);
}

export function unsubscribeAllRealtime(): void {
  realtimeService.unsubscribeAll();
}
