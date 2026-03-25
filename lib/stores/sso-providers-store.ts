/**
 * SSO Providers Management Store
 * Manages SSO providers state using Zustand.
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import { createLoadActions } from './sso-providers-store/load-actions';
import { createMutationActions } from './sso-providers-store/mutation-actions';
import { initialState } from './sso-providers-store/state';
import type { SsoProvidersState } from './sso-providers-store/types';
import { createUiActions } from './sso-providers-store/ui-actions';

export type {
  CreateSsoProviderData,
  SsoProvider,
  SsoProviderFilters,
  SsoProviderStats,
  UpdateSsoProviderData,
} from './sso-providers-store/types';

export const useSsoProvidersStore = create<SsoProvidersState>()(
  devtools(
    (set, get) => ({
      ...initialState,
      ...createLoadActions(set, get),
      ...createMutationActions(set, get),
      ...createUiActions(set, get),
    }),
    {
      name: 'sso-providers-store',
    }
  )
);
