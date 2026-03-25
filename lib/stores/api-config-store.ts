import type { ApiKey, Provider, ServiceInstance } from '@lib/types/database';
import { create } from 'zustand';

import { createConfigActions } from './api-config-store/config-actions';
import { createInstanceActions } from './api-config-store/instance-actions';
import type { ApiConfigState } from './api-config-store/types';

export type { ApiKey, Provider, ServiceInstance } from '@lib/types/database';

export const useApiConfigStore = create<ApiConfigState>((set, get) => ({
  providers: [],
  serviceInstances: [],
  apiKeys: [],
  isLoading: false,
  error: null,
  newApiKey: '',
  newApiUrl: '',
  isUpdating: false,
  ...createInstanceActions(set, get),
  ...createConfigActions(set, get),
  setNewApiKey: key => set({ newApiKey: key }),
  setNewApiUrl: url => set({ newApiUrl: url }),
}));
