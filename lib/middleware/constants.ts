export const BETTER_AUTH_BASE_PATH = '/api/auth/better';
export const INTERNAL_DATA_BASE_PATH = '/api/internal/data';
export const INTERNAL_PROFILE_STATUS_PATH = '/api/internal/auth/profile-status';
export const INTERNAL_STORAGE_BASE_PATH = '/api/internal/storage';
export const INTERNAL_REALTIME_BASE_PATH = '/api/internal/realtime';
export const ADMIN_API_BASE_PATH = '/api/admin';
export const INTERNAL_AUTH_PROXY_HEADER = 'x-agentifui-internal-auth-proxy';
export const INTERNAL_FETCH_TIMEOUT_MS_FALLBACK = 3000;

export type BetterAuthSessionPayload = {
  user?: {
    id?: string;
    [key: string]: unknown;
  } | null;
  [key: string]: unknown;
};

export type ProfileStatusPayload = {
  role: string | null;
  status: string | null;
};
