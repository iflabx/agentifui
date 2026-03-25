import type { ApiKey, Provider, ServiceInstance } from '@lib/types/database';
import type { Result } from '@lib/types/result';

export function handleResult<T>(result: Result<T>, operation: string): T {
  if (!result.success) {
    throw new Error(`${operation} failed: ${result.error.message}`);
  }
  return result.data;
}

export function buildServiceInstancePayload(
  instance: Partial<ServiceInstance>
) {
  return {
    provider_id: instance.provider_id || '1',
    display_name: instance.display_name || '',
    description: instance.description || '',
    instance_id: instance.instance_id || '',
    api_path: instance.api_path || '',
    is_default: instance.is_default || false,
    visibility: instance.visibility || 'public',
    config: instance.config || {},
  };
}

export function sortServiceInstances(serviceInstances: ServiceInstance[]) {
  return [...serviceInstances].sort((a, b) =>
    (a.display_name || a.instance_id).localeCompare(
      b.display_name || b.instance_id
    )
  );
}

export function buildDefaultDifyProvider(
  baseUrl: string
): Omit<Provider, 'id' | 'created_at' | 'updated_at'> {
  return {
    name: 'Dify',
    type: 'llm',
    base_url: baseUrl,
    auth_type: 'api_key',
    is_active: true,
    is_default: false,
  };
}

export function buildDefaultDifyInstance(
  providerId: string
): Omit<ServiceInstance, 'id' | 'created_at' | 'updated_at'> {
  return {
    provider_id: providerId,
    display_name: 'Default Dify Application',
    description: 'Default Dify application instance',
    instance_id: 'default',
    api_path: '',
    is_default: true,
    visibility: 'public',
    config: {},
  };
}

export function appendApiKey(apiKeys: ApiKey[], apiKey: ApiKey) {
  return [...apiKeys, apiKey];
}
