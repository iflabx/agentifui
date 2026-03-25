export type AuthMode = 'normal' | 'degraded';

export interface LocalLoginPolicyContext {
  actorUserId?: string | null;
  useSystemActor?: boolean;
}

export type ProfileLocalLoginRow = {
  id: string;
  auth_source: string | null;
  local_login_enabled: boolean | null;
};

export type AuthModeRow = {
  auth_mode: string | null;
};

export type ProfileLocalLoginStateRow = {
  id: string;
  email: string | null;
  auth_source: string | null;
  local_login_enabled: boolean | null;
  local_login_updated_at: string | Date | null;
  fallback_password_set_at: string | Date | null;
  fallback_password_updated_by: string | null;
  updated_at?: string | Date | null;
};

export type CredentialPasswordExistsRow = {
  has_credential_password: boolean | null;
};

export type RealtimeRow = Record<string, unknown>;

export type RealtimePublisher = (input: {
  table: string;
  eventType: 'INSERT' | 'UPDATE' | 'DELETE';
  newRow: RealtimeRow | null;
  oldRow: RealtimeRow | null;
  schema?: string;
  commitTimestamp?: string;
}) => Promise<void>;

export type LocalLoginDecisionReason =
  | 'email_missing'
  | 'profile_not_found'
  | 'password_account'
  | 'blocked_auth_mode'
  | 'blocked_user_toggle'
  | 'missing_fallback_password'
  | 'allowed_degraded';

export interface LocalLoginDecision {
  allowed: boolean;
  authMode: AuthMode;
  email: string | null;
  userId: string | null;
  reason: LocalLoginDecisionReason;
}

export interface UserLocalLoginState {
  userId: string;
  email: string | null;
  authSource: string | null;
  localLoginEnabled: boolean;
  localLoginUpdatedAt: string | null;
  fallbackPasswordSetAt: string | null;
  fallbackPasswordUpdatedBy: string | null;
}

export interface LocalLoginAuditInput {
  email: string | null;
  userId: string | null;
  authMode: AuthMode;
  outcome: 'blocked' | 'success' | 'failed';
  reason: string | null;
  statusCode?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
}
