export interface ActorIdentity {
  userId: string;
  role: string;
}

export interface ProfileStatusIdentity extends ActorIdentity {
  authUserId: string;
  status: string | null;
}

export type ResolveIdentityResult =
  | { kind: 'ok'; identity: ActorIdentity }
  | { kind: 'unauthorized' }
  | { kind: 'error'; reason: string };

export type ResolveProfileStatusResult =
  | { kind: 'ok'; identity: ProfileStatusIdentity }
  | { kind: 'unauthorized' }
  | { kind: 'error'; reason: string };

export interface SessionIdentityRow {
  auth_user_id: string | null;
  user_id: string | null;
  role: string | null;
  status: string | null;
}

export type SessionResolverMetricKey =
  | 'local_ok'
  | 'local_unauthorized'
  | 'local_error';

export type SessionResolverMetrics = Record<SessionResolverMetricKey, number>;
