import type {
  CreateSsoProviderData,
  SsoProtocol,
  SsoProvider,
} from '@lib/types/database';

export type { CreateSsoProviderData, SsoProtocol, SsoProvider };

export interface SsoProviderFilters {
  protocol?: SsoProtocol;
  enabled?: boolean;
  search?: string;
  sortBy?: 'name' | 'protocol' | 'created_at' | 'display_order';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export interface SsoProviderStats {
  total: number;
  enabled: number;
  disabled: number;
  byProtocol: Record<SsoProtocol, number>;
}

export interface UpdateSsoProviderData {
  name?: string;
  protocol?: SsoProtocol;
  settings?: SsoProvider['settings'];
  client_id?: string | null;
  client_secret?: string | null;
  metadata_url?: string | null;
  enabled?: boolean;
  display_order?: number;
  button_text?: string | null;
}

export interface LoadingState {
  providers: boolean;
  stats: boolean;
  providerDetail: boolean;
  updating: boolean;
  deleting: boolean;
  creating: boolean;
  toggling: boolean;
  reordering: boolean;
}

export interface FilterOptions {
  protocols: SsoProtocol[];
  enabledOptions: Array<{ value: boolean; label: string }>;
}

export interface PaginationState {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ProvidersListPayload {
  providers: SsoProvider[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface SsoProvidersState {
  providers: SsoProvider[];
  stats: SsoProviderStats | null;
  selectedProvider: SsoProvider | null;
  selectedProviderIds: string[];
  filterOptions: FilterOptions;
  filters: SsoProviderFilters;
  pagination: PaginationState;
  loading: LoadingState;
  error: string | null;
  showProviderDetail: boolean;
  showCreateForm: boolean;
  showEditForm: boolean;
  showDeleteConfirm: boolean;
  loadProviders: () => Promise<void>;
  loadStats: () => Promise<void>;
  loadProviderDetail: (providerId: string) => Promise<void>;
  loadFilterOptions: () => Promise<void>;
  updateFilters: (filters: Partial<SsoProviderFilters>) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  selectProvider: (provider: SsoProvider) => void;
  selectProviders: (providerIds: string[]) => void;
  toggleProviderSelection: (providerId: string) => void;
  clearSelection: () => void;
  addProvider: (data: CreateSsoProviderData) => Promise<boolean>;
  editProvider: (id: string, data: UpdateSsoProviderData) => Promise<boolean>;
  removeProvider: (id: string) => Promise<boolean>;
  toggleProviderStatus: (id: string, enabled: boolean) => Promise<boolean>;
  reorderProviders: (
    updates: Array<{ id: string; display_order: number }>
  ) => Promise<boolean>;
  showCreateProviderForm: () => void;
  showEditProviderForm: (provider: SsoProvider) => void;
  showDeleteProviderConfirm: (provider: SsoProvider) => void;
  showProviderDetailModal: (provider: SsoProvider) => void;
  hideCreateForm: () => void;
  hideEditForm: () => void;
  hideDeleteConfirm: () => void;
  hideProviderDetailModal: () => void;
  clearError: () => void;
  resetStore: () => void;
}

export type SsoProvidersStoreSet = (
  partial:
    | Partial<SsoProvidersState>
    | ((state: SsoProvidersState) => Partial<SsoProvidersState>)
) => void;
export type SsoProvidersStoreGet = () => SsoProvidersState;
