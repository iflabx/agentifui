interface AuthJsonResult {
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

interface InternalProfileStatusPayload {
  userId?: string;
  authUserId?: string;
  role?: string | null;
  status?: string | null;
}

const AUTH_STATE_CHANGE_EVENT = 'agentifui:auth-state-changed';
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

async function getInternalProfileStatus(): Promise<InternalProfileStatusPayload | null> {
  const response = await fetch('/api/internal/auth/profile-status', {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401 || response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(
      `Failed to resolve internal profile status (${response.status})`
    );
  }

  const payload = (await response
    .json()
    .catch(() => null)) as InternalProfileStatusPayload | null;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  return payload;
}

function emitAuthStateChanged() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
}

async function requestJson<T extends AuthJsonResult>(
  path: string,
  init: RequestInit
): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as T;
  if (!response.ok) {
    throw new Error(
      payload?.error?.message ||
        payload?.error?.code ||
        `Authentication request failed (${response.status})`
    );
  }

  return payload;
}

export async function signInWithEmailPassword(
  email: string,
  password: string,
  callbackURL: string
) {
  const payload = await requestJson<{
    redirect: boolean;
    token: string;
    url?: string;
  }>('/api/auth/better/sign-in/email', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      callbackURL,
    }),
  });
  emitAuthStateChanged();
  return payload;
}

export async function signUpWithEmail(
  name: string,
  email: string,
  password: string,
  callbackURL: string,
  extraFields?: Record<string, unknown>
) {
  const payload = await requestJson<{
    token?: string | null;
    user?: BetterAuthUser;
  }>('/api/auth/better/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({
      name,
      email,
      password,
      callbackURL,
      ...(extraFields || {}),
    }),
  });
  emitAuthStateChanged();
  return payload;
}

export async function signInWithSocialProvider(
  provider: string,
  callbackURL: string
) {
  return requestJson<{
    redirect: boolean;
    url: string;
  }>('/api/auth/better/sign-in/social', {
    method: 'POST',
    body: JSON.stringify({
      provider,
      callbackURL,
      disableRedirect: true,
    }),
  });
}

export async function signInWithSsoProvider(
  providerId: string,
  callbackURL: string,
  errorCallbackURL: string
) {
  return requestJson<{
    redirect: true;
    url: string;
  }>('/api/auth/better/sign-in/sso', {
    method: 'POST',
    body: JSON.stringify({
      providerId,
      callbackURL,
      errorCallbackURL,
    }),
  });
}

export async function signOutCurrentSession() {
  const payload = await requestJson<{ success: boolean }>(
    '/api/auth/better/sign-out',
    {
      method: 'POST',
      body: JSON.stringify({}),
    }
  );
  emitAuthStateChanged();
  return payload;
}

export async function requestPasswordReset(email: string, redirectTo?: string) {
  return requestJson<{ status: boolean; message: string }>(
    '/api/auth/better/request-password-reset',
    {
      method: 'POST',
      body: JSON.stringify({
        email,
        redirectTo,
      }),
    }
  );
}

export async function resetPasswordWithToken(
  newPassword: string,
  token?: string
) {
  const payload = await requestJson<{ status: boolean }>(
    '/api/auth/better/reset-password',
    {
      method: 'POST',
      body: JSON.stringify({
        newPassword,
        token,
      }),
    }
  );
  emitAuthStateChanged();
  return payload;
}

export async function sendPhoneOtp(phoneNumber: string) {
  return requestJson<{ message: string }>(
    '/api/auth/better/phone-number/send-otp',
    {
      method: 'POST',
      body: JSON.stringify({
        phoneNumber,
      }),
    }
  );
}

export async function verifyPhoneOtp(phoneNumber: string, code: string) {
  const payload = await requestJson<{ status: boolean; token?: string | null }>(
    '/api/auth/better/phone-number/verify',
    {
      method: 'POST',
      body: JSON.stringify({
        phoneNumber,
        code,
      }),
    }
  );
  emitAuthStateChanged();
  return payload;
}

export function subscribeAuthStateChange(listener: () => void): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handler = () => listener();
  window.addEventListener(AUTH_STATE_CHANGE_EVENT, handler);
  window.addEventListener('focus', handler);

  return () => {
    window.removeEventListener(AUTH_STATE_CHANGE_EVENT, handler);
    window.removeEventListener('focus', handler);
  };
}

export async function getCurrentSession(): Promise<BetterAuthSession | null> {
  const response = await fetch('/api/auth/better/get-session', {
    method: 'GET',
    credentials: 'include',
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Failed to get session (${response.status})`);
  }

  const payload = (await response
    .json()
    .catch(() => null)) as BetterAuthSession;
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const sessionUser = payload.user;
  const authUserId = asString(sessionUser?.id);

  if (!sessionUser || !authUserId) {
    return null;
  }

  if (isUuid(authUserId)) {
    return payload;
  }

  const profileStatus = await getInternalProfileStatus();
  const internalUserId = asString(profileStatus?.userId);
  const resolvedAuthUserId = asString(profileStatus?.authUserId) || authUserId;

  if (!internalUserId) {
    throw new Error('Failed to resolve internal UUID for current session user');
  }

  const patchedSession: BetterAuthSession = {
    ...payload,
    session: payload.session
      ? {
          ...payload.session,
          userId: internalUserId,
          authUserId: resolvedAuthUserId,
        }
      : payload.session,
    user: {
      ...sessionUser,
      id: internalUserId,
      auth_user_id: resolvedAuthUserId,
      role:
        typeof profileStatus?.role === 'string'
          ? profileStatus.role
          : sessionUser.role,
      status:
        typeof profileStatus?.status === 'string'
          ? profileStatus.status
          : sessionUser.status,
    },
  };

  return patchedSession;
}

export async function getCurrentUser(): Promise<BetterAuthUser | null> {
  const session = await getCurrentSession();
  return session?.user ?? null;
}
