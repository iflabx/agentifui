import { callInternalDataAction } from '@lib/db/internal-data-api';
import type { Provider } from '@lib/types/database';
import type { Result } from '@lib/types/result';

type ProviderInput = Omit<Provider, 'id' | 'created_at' | 'updated_at'>;
type ProviderUpdates = Partial<
  Omit<Provider, 'id' | 'created_at' | 'updated_at'>
>;

export function getAllProviders(): Promise<Result<Provider[]>> {
  return callInternalDataAction<Provider[]>('providers.getAllProviders');
}

export function createProvider(
  provider: ProviderInput
): Promise<Result<Provider>> {
  return callInternalDataAction<Provider>('providers.createProvider', {
    provider,
  });
}

export function updateProvider(
  id: string,
  updates: ProviderUpdates
): Promise<Result<Provider>> {
  return callInternalDataAction<Provider>('providers.updateProvider', {
    id,
    updates,
  });
}

export function deleteProvider(id: string): Promise<Result<boolean>> {
  return callInternalDataAction<boolean>('providers.deleteProvider', { id });
}
