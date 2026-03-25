export interface IdentityPersistenceContext {
  actorUserId?: string | null;
  useSystemActor?: boolean;
}

export interface UpsertUserIdentityInput {
  user_id: string;
  issuer: string;
  provider: string;
  subject: string;
  email?: string | null;
  email_verified?: boolean;
  given_name?: string | null;
  family_name?: string | null;
  preferred_username?: string | null;
  raw_claims?: Record<string, unknown>;
}

export interface UpsertProfileExternalAttributesInput {
  user_id: string;
  source_issuer: string;
  source_provider: string;
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
  raw_profile?: Record<string, unknown>;
}

export const INTERNAL_AUTH_PROVIDER = 'better-auth';
