import { callInternalDataAction } from '@lib/db/internal-data-api';
import { create } from 'zustand';

interface Group {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  member_count?: number;
}

interface GroupMember {
  id: string;
  group_id: string;
  user_id: string;
  created_at: string;
  user?: {
    id: string;
    username: string | null;
    full_name: string | null;
    email: string | null;
  };
}

interface GroupStats {
  totalGroups: number;
  totalMembers: number;
  activeGroups: number;
}

interface GroupManagementState {
  // Data state
  groups: Group[];
  currentGroup: Group | null;
  groupMembers: Record<string, GroupMember[]>;
  stats: GroupStats;

  // Loading state
  loading: {
    groups: boolean;
    members: boolean;
    stats: boolean;
    creating: boolean;
    updating: boolean;
    deleting: boolean;
  };

  // Error state
  error: string | null;

  // Filter state
  searchTerm: string;

  // Action methods
  loadGroups: () => Promise<void>;
  loadGroupMembers: (groupId: string) => Promise<void>;
  loadStats: () => Promise<void>;

  createGroup: (data: {
    name: string;
    description?: string;
  }) => Promise<boolean>;
  updateGroup: (
    groupId: string,
    data: { name?: string; description?: string }
  ) => Promise<boolean>;
  deleteGroup: (groupId: string) => Promise<boolean>;

  addMember: (groupId: string, userId: string) => Promise<boolean>;
  removeMember: (groupId: string, userId: string) => Promise<boolean>;

  setCurrentGroup: (group: Group | null) => void;
  setSearchTerm: (term: string) => void;
  clearError: () => void;
}

export const useGroupManagementStore = create<GroupManagementState>(
  (set, get) => ({
    // Initial state
    groups: [],
    currentGroup: null,
    groupMembers: {},
    stats: {
      totalGroups: 0,
      totalMembers: 0,
      activeGroups: 0,
    },

    loading: {
      groups: false,
      members: false,
      stats: false,
      creating: false,
      updating: false,
      deleting: false,
    },

    error: null,
    searchTerm: '',

    // Load group list
    loadGroups: async () => {
      set(state => ({
        loading: { ...state.loading, groups: true },
        error: null,
      }));

      try {
        const result =
          await callInternalDataAction<Group[]>('groups.getGroups');

        if (result.success) {
          set(state => ({
            groups: result.data,
            loading: { ...state.loading, groups: false },
          }));
        } else {
          set(state => ({
            error: result.error.message,
            loading: { ...state.loading, groups: false },
          }));
        }
      } catch {
        set(state => ({
          error: 'Failed to load groups',
          loading: { ...state.loading, groups: false },
        }));
      }
    },

    // Load group members
    loadGroupMembers: async (groupId: string) => {
      set(state => ({
        loading: { ...state.loading, members: true },
        error: null,
      }));

      try {
        const result = await callInternalDataAction<GroupMember[]>(
          'groups.getGroupMembers',
          { groupId }
        );

        if (result.success) {
          set(state => ({
            groupMembers: {
              ...state.groupMembers,
              [groupId]: result.data,
            },
            loading: { ...state.loading, members: false },
          }));
        } else {
          set(state => ({
            error: result.error.message,
            loading: { ...state.loading, members: false },
          }));
        }
      } catch {
        set(state => ({
          error: 'Failed to load group members',
          loading: { ...state.loading, members: false },
        }));
      }
    },

    // Load statistics
    loadStats: async () => {
      set(state => ({
        loading: { ...state.loading, stats: true },
        error: null,
      }));

      try {
        const groupsResult =
          await callInternalDataAction<Group[]>('groups.getGroups');

        if (groupsResult.success) {
          const groups = groupsResult.data;
          const totalGroups = groups.length;

          // Use member_count field in group data to calculate total members
          // Avoid querying members for each group to prevent failures for new groups
          const totalMembers = groups.reduce((sum, group) => {
            return sum + (group.member_count || 0);
          }, 0);

          const stats: GroupStats = {
            totalGroups,
            totalMembers,
            activeGroups: totalGroups, // All groups are considered active for now
          };

          set(state => ({
            stats,
            loading: { ...state.loading, stats: false },
          }));
        } else {
          set(state => ({
            error: groupsResult.error.message,
            loading: { ...state.loading, stats: false },
          }));
        }
      } catch {
        set(state => ({
          error: 'Failed to load stats',
          loading: { ...state.loading, stats: false },
        }));
      }
    },

    // Create group
    createGroup: async data => {
      set(state => ({
        loading: { ...state.loading, creating: true },
        error: null,
      }));

      try {
        const result = await callInternalDataAction<Group>(
          'groups.createGroup',
          {
            data,
          }
        );

        if (result.success) {
          // Directly add the new group to the list to avoid reloading
          const newGroup = { ...result.data, member_count: 0 };
          set(state => ({
            groups: [newGroup, ...state.groups],
            // Immediately update statistics
            stats: {
              ...state.stats,
              totalGroups: state.stats.totalGroups + 1,
              activeGroups: state.stats.activeGroups + 1,
            },
            loading: { ...state.loading, creating: false },
          }));
          return true;
        } else {
          set(state => ({
            error: result.error.message,
            loading: { ...state.loading, creating: false },
          }));
          return false;
        }
      } catch {
        set(state => ({
          error: 'Failed to create group',
          loading: { ...state.loading, creating: false },
        }));
        return false;
      }
    },

    // Update group
    updateGroup: async (groupId, data) => {
      set(state => ({
        loading: { ...state.loading, updating: true },
        error: null,
      }));

      try {
        const result = await callInternalDataAction<Group>(
          'groups.updateGroup',
          {
            groupId,
            data,
          }
        );

        if (result.success) {
          // Update local state
          set(state => ({
            groups: state.groups.map(group =>
              group.id === groupId ? { ...group, ...data } : group
            ),
            currentGroup:
              state.currentGroup?.id === groupId
                ? { ...state.currentGroup, ...data }
                : state.currentGroup,
            loading: { ...state.loading, updating: false },
          }));
          return true;
        } else {
          set(state => ({
            error: result.error.message,
            loading: { ...state.loading, updating: false },
          }));
          return false;
        }
      } catch {
        set(state => ({
          error: 'Failed to update group',
          loading: { ...state.loading, updating: false },
        }));
        return false;
      }
    },

    // Delete group
    deleteGroup: async groupId => {
      set(state => ({
        loading: { ...state.loading, deleting: true },
        error: null,
      }));

      try {
        const result = await callInternalDataAction<void>(
          'groups.deleteGroup',
          {
            groupId,
          }
        );

        if (result.success) {
          // Get the member count of the deleted group for updating statistics
          const deletedGroup = get().groups.find(g => g.id === groupId);
          const memberCount = deletedGroup?.member_count || 0;

          // Update local state
          set(state => ({
            groups: state.groups.filter(group => group.id !== groupId),
            currentGroup:
              state.currentGroup?.id === groupId ? null : state.currentGroup,
            groupMembers: Object.fromEntries(
              Object.entries(state.groupMembers).filter(
                ([id]) => id !== groupId
              )
            ),
            // Immediately update statistics
            stats: {
              ...state.stats,
              totalGroups: state.stats.totalGroups - 1,
              totalMembers: state.stats.totalMembers - memberCount,
              activeGroups: state.stats.activeGroups - 1,
            },
            loading: { ...state.loading, deleting: false },
          }));

          return true;
        } else {
          set(state => ({
            error: result.error.message,
            loading: { ...state.loading, deleting: false },
          }));
          return false;
        }
      } catch {
        set(state => ({
          error: 'Failed to delete group',
          loading: { ...state.loading, deleting: false },
        }));
        return false;
      }
    },

    // Add member
    addMember: async (groupId, userId) => {
      try {
        const result = await callInternalDataAction<GroupMember>(
          'groups.addGroupMember',
          { groupId, userId }
        );

        if (result.success) {
          // Reload the member list for this group
          await get().loadGroupMembers(groupId);
          // Update the member count in the group list and statistics
          set(state => ({
            groups: state.groups.map(group =>
              group.id === groupId
                ? { ...group, member_count: (group.member_count || 0) + 1 }
                : group
            ),
            stats: {
              ...state.stats,
              totalMembers: state.stats.totalMembers + 1,
            },
          }));
          return true;
        } else {
          set({ error: result.error.message });
          return false;
        }
      } catch {
        set({ error: 'Failed to add member' });
        return false;
      }
    },

    // Remove member
    removeMember: async (groupId, userId) => {
      try {
        const result = await callInternalDataAction<void>(
          'groups.removeGroupMember',
          { groupId, userId }
        );

        if (result.success) {
          // Reload the member list for this group
          await get().loadGroupMembers(groupId);
          // Update the member count in the group list and statistics
          set(state => ({
            groups: state.groups.map(group =>
              group.id === groupId
                ? {
                    ...group,
                    member_count: Math.max((group.member_count || 0) - 1, 0),
                  }
                : group
            ),
            stats: {
              ...state.stats,
              totalMembers: Math.max(state.stats.totalMembers - 1, 0),
            },
          }));
          return true;
        } else {
          set({ error: result.error.message });
          return false;
        }
      } catch {
        set({ error: 'Failed to remove member' });
        return false;
      }
    },

    // Set current group
    setCurrentGroup: group => {
      set({ currentGroup: group });
    },

    // Set search term
    setSearchTerm: term => {
      set({ searchTerm: term });
    },

    // Clear error
    clearError: () => {
      set({ error: null });
    },
  })
);
