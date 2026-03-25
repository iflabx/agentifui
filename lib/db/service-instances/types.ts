import type { ServiceInstance } from '../../types/database';

export const IS_BROWSER = typeof window !== 'undefined';
export const SQL_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
export const SERVICE_INSTANCE_UPDATE_COLUMNS = new Set([
  'provider_id',
  'display_name',
  'description',
  'instance_id',
  'api_path',
  'is_default',
  'visibility',
  'config',
]);

export type RealtimeRow = Record<string, unknown>;
export type QueryClient = {
  query: <T extends object = Record<string, unknown>>(
    sql: string,
    params?: unknown[]
  ) => Promise<{
    rows: T[];
    rowCount?: number | null;
  }>;
};

export type ServiceInstanceUpdateInput = Partial<
  Omit<ServiceInstance, 'id' | 'created_at' | 'updated_at'>
>;
