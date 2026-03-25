export interface AuthJsonResult {
  success?: boolean;
  error?: {
    code?: string;
    message?: string;
  };
  [key: string]: unknown;
}

export interface BetterAuthUser {
  id: string;
  auth_user_id?: string | null;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  emailVerified?: boolean;
  last_sign_in_at?: string | null;
  role?: string | null;
  status?: string | null;
  app_metadata?: {
    provider?: string;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
}

export interface BetterAuthSession {
  session?: {
    id?: string;
    userId?: string;
    authUserId?: string;
    [key: string]: unknown;
  } | null;
  user?: BetterAuthUser | null;
  [key: string]: unknown;
}

export interface InternalProfileStatusPayload {
  userId?: string;
  authUserId?: string;
  role?: string | null;
  status?: string | null;
}
