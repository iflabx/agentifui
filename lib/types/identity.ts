/**
 * Identity-domain types separated from the legacy database.ts file.
 * This avoids touching broad legacy typings while migrating auth/data gradually.
 */

export interface UserIdentity {
  id: string;
  user_id: string;
  issuer: string;
  provider: string;
  subject: string;
  email: string | null;
  email_verified: boolean;
  given_name: string | null;
  family_name: string | null;
  preferred_username: string | null;
  raw_claims: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
}

export interface ProfileExternalAttributes {
  user_id: string;
  source_issuer: string;
  source_provider: string;
  employee_number: string | null;
  department_code: string | null;
  department_name: string | null;
  department_path: string | null;
  cost_center: string | null;
  job_title: string | null;
  employment_type: string | null;
  manager_employee_number: string | null;
  manager_name: string | null;
  phone_e164: string | null;
  office_location: string | null;
  hire_date: string | null;
  attributes: Record<string, unknown>;
  raw_profile: Record<string, unknown>;
  locked: boolean;
  synced_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}
