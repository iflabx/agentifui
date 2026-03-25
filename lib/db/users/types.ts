import type { AccountStatus, Profile, UserRole } from '@lib/types/database';

export type ProfileUpdate = Partial<Omit<Profile, 'id' | 'created_at'>>;

export interface EnhancedUser {
  id: string;
  email?: string | null;
  phone?: string | null;
  email_confirmed_at?: string | null;
  phone_confirmed_at?: string | null;
  created_at: string;
  updated_at: string;
  last_sign_in_at?: string | null;
  full_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  role: UserRole;
  status: AccountStatus;
  auth_source?: string;
  is_idp_managed?: boolean;
  editable_fields?: string[];
  sso_provider_id?: string | null;
  employee_number?: string | null;
  external_profile?: {
    source_issuer?: string | null;
    source_provider?: string | null;
    employee_number?: string | null;
    department_code?: string | null;
    department_name?: string | null;
    department_path?: string | null;
    cost_center?: string | null;
    job_title?: string | null;
    employment_type?: string | null;
    manager_employee_number?: string | null;
    manager_name?: string | null;
    phone_e164?: string | null;
    office_location?: string | null;
    hire_date?: string | null;
    attributes?: Record<string, unknown>;
    locked?: boolean;
    synced_at?: string | null;
    last_seen_at?: string | null;
  } | null;
  profile_created_at: string;
  profile_updated_at: string;
  last_login?: string | null;
  groups?: Array<{
    id: string;
    name: string;
    description?: string | null;
    joined_at: string;
  }>;
}

export interface UserStats {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  pendingUsers: number;
  adminUsers: number;
  managerUsers: number;
  regularUsers: number;
  newUsersToday: number;
  newUsersThisWeek: number;
  newUsersThisMonth: number;
}

export interface UserFilters {
  role?: UserRole;
  status?: AccountStatus;
  auth_source?: string;
  search?: string;
  sortBy?: 'created_at' | 'last_sign_in_at' | 'email' | 'full_name';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

export const USER_SORT_COLUMN_MAP: Record<
  NonNullable<UserFilters['sortBy']>,
  string
> = {
  created_at: 'p.created_at',
  last_sign_in_at: 'p.last_login',
  email: 'p.email',
  full_name: 'p.full_name',
};
