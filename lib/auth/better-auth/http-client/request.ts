import { emitAuthStateChanged } from './cache';
import type { AuthJsonResult, BetterAuthUser } from './types';

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
