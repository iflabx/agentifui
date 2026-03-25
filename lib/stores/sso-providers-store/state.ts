import type { SsoProvidersState } from './types';

export const initialState: Pick<
  SsoProvidersState,
  | 'providers'
  | 'stats'
  | 'selectedProvider'
  | 'selectedProviderIds'
  | 'filterOptions'
  | 'filters'
  | 'pagination'
  | 'loading'
  | 'error'
  | 'showProviderDetail'
  | 'showCreateForm'
  | 'showEditForm'
  | 'showDeleteConfirm'
> = {
  providers: [],
  stats: null,
  selectedProvider: null,
  selectedProviderIds: [],
  filterOptions: {
    protocols: ['CAS', 'SAML', 'OAuth2', 'OIDC'],
    enabledOptions: [
      { value: true, label: 'Enabled' },
      { value: false, label: 'Disabled' },
    ],
  },
  filters: {
    page: 1,
    pageSize: 20,
    sortBy: 'display_order',
    sortOrder: 'asc',
  },
  pagination: {
    total: 0,
    page: 1,
    pageSize: 20,
    totalPages: 0,
  },
  loading: {
    providers: false,
    stats: false,
    providerDetail: false,
    updating: false,
    deleting: false,
    creating: false,
    toggling: false,
    reordering: false,
  },
  error: null,
  showProviderDetail: false,
  showCreateForm: false,
  showEditForm: false,
  showDeleteConfirm: false,
};
