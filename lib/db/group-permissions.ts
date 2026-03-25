/**
 * Database query functions related to group permissions and access checks.
 * Uses PostgreSQL directly on server and internal API bridge on browser.
 */
export type {
  AppPermissionCheck,
  Group,
  GroupAppPermission,
  GroupMember,
  SearchableUser,
  UserAccessibleApp,
} from './group-permissions/types';
export {
  createGroup,
  deleteGroup,
  getGroups,
  updateGroup,
} from './group-permissions/group-operations';
export {
  addGroupMember,
  getGroupMembers,
  removeGroupMember,
  searchUsersForGroup,
} from './group-permissions/member-operations';
export {
  getGroupAppPermissions,
  removeAllGroupAppPermissions,
  removeGroupAppPermission,
  setGroupAppPermission,
} from './group-permissions/app-permission-operations';
export {
  checkUserAppPermission,
  getUserAccessibleApps,
  incrementAppUsage,
} from './group-permissions/user-access-operations';
