/**
 * Database query functions related to user management.
 * Uses PostgreSQL directly on server and internal API bridge on browser.
 */
export type {
  EnhancedUser,
  ProfileUpdate,
  UserFilters,
  UserStats,
} from './users/types';
export {
  batchUpdateUserRole,
  batchUpdateUserStatus,
  createUserProfile,
  deleteUser,
  updateUserProfile,
  updateUserRole,
  updateUserStatus,
} from './users/write-operations';
export {
  getUserById,
  getUserList,
  getUserStats,
} from './users/read-operations';
