/**
 * User Management State Store
 * Uses Zustand to manage the state for the user management interface.
 */
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

import { createLoadActions } from './user-management-store/load-actions';
import { createMutationActions } from './user-management-store/mutation-actions';
import { createSelectionActions } from './user-management-store/selection-actions';
import { initialState } from './user-management-store/state';
import type { UserManagementState } from './user-management-store/types';

export type {
  EnhancedUser,
  UserFilters,
  UserStats,
} from './user-management-store/types';

export const useUserManagementStore = create<UserManagementState>()(
  devtools(
    (set, get) => ({
      ...initialState,
      ...createLoadActions(set, get),
      ...createSelectionActions(set, get),
      ...createMutationActions(set, get),
    }),
    {
      name: 'user-management-store',
      partialize: (state: UserManagementState) => ({
        filters: state.filters,
      }),
    }
  )
);
