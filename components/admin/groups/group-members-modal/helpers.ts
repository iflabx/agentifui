import type { GroupMember, SearchableUser } from '@lib/db/group-permissions';

export function filterGroupMembers(
  members: GroupMember[],
  searchTerm: string
): GroupMember[] {
  const normalizedSearch = searchTerm.trim().toLowerCase();
  if (!normalizedSearch) {
    return members;
  }

  return members.filter(member => {
    const user = member.user;
    if (!user) {
      return false;
    }

    return [user.username, user.full_name, user.email].some(value =>
      value?.toLowerCase().includes(normalizedSearch)
    );
  });
}

export function createGroupUserPagination() {
  return {
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 0,
  };
}

export function toggleSelectedUserIds(
  selectedUserIds: string[],
  userId: string
): string[] {
  return selectedUserIds.includes(userId)
    ? selectedUserIds.filter(id => id !== userId)
    : [...selectedUserIds, userId];
}

export function selectAllVisibleUsers(
  users: SearchableUser[],
  selected: boolean
): string[] {
  return selected ? users.map(user => user.id) : [];
}

export function getPaginationRange(
  page: number,
  pageSize: number,
  total: number
) {
  return {
    start: (page - 1) * pageSize + 1,
    end: Math.min(page * pageSize, total),
    total,
  };
}
