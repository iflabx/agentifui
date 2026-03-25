import type { ApiKey, Provider, ServiceInstance } from '@lib/types/database';

export interface ApiConfigState {
  providers: Provider[];
  serviceInstances: ServiceInstance[];
  apiKeys: ApiKey[];
  isLoading: boolean;
  error: Error | null;
  newApiKey: string;
  newApiUrl: string;
  isUpdating: boolean;
  createAppInstance: (
    instance: Partial<ServiceInstance>,
    apiKey?: string
  ) => Promise<ServiceInstance>;
  updateAppInstance: (
    id: string,
    instance: Partial<ServiceInstance>,
    apiKey?: string
  ) => Promise<ServiceInstance>;
  deleteAppInstance: (id: string) => Promise<void>;
  setDefaultInstance: (instanceId: string) => Promise<void>;
  loadConfigData: () => Promise<void>;
  updateDifyConfig: () => Promise<void>;
  setNewApiKey: (key: string) => void;
  setNewApiUrl: (url: string) => void;
}

export type ApiConfigStoreSet = (partial: Partial<ApiConfigState>) => void;
export type ApiConfigStoreGet = () => ApiConfigState;
