interface AuthJsonResult {
  success?: boolean;
  error?: {
    code?: string;
    message?: string;
  };
  [key: string]: unknown;
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
  return requestJson<{
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
  return requestJson<{ success: boolean }>('/api/auth/better/sign-out', {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export async function getCurrentSession() {
  const response = await fetch('/api/auth/better/get-session', {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to get session (${response.status})`);
  }

  return response.json();
}
