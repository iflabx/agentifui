export type AuthSession = Awaited<
  ReturnType<
    (typeof import('@lib/auth/better-auth/server'))['auth']['api']['getSession']
  >
>;

export type SessionUser = Record<string, unknown> & {
  id: string;
  email?: string | null;
  name?: string | null;
  image?: string | null;
  emailVerified?: boolean;
};

export type ProfileStatusRow = {
  id?: string;
  full_name?: string | null;
  avatar_url?: string | null;
  email?: string | null;
  auth_source?: string | null;
  last_login?: string | null;
  updated_at?: string | null;
  role: string | null;
  status: string | null;
};

export type EnsureProfileResult = {
  role: string | null;
  status: string | null;
  created: boolean;
};

export type ResolveUserIdResult = {
  userId: string;
  createdLegacyMapping: boolean;
  ensuredProfile?: EnsureProfileResult;
};

export type ResolveUserIdReadOnlyResult = {
  userId: string;
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
