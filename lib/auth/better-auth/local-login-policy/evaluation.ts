import { Result, failure, success } from '@lib/types/result';

import { SYSTEM_POLICY_CONTEXT } from './context';
import { isLocalPasswordAuthSource, normalizeEmail } from './helpers';
import {
  getCurrentAuthMode,
  getProfileByEmail,
  hasCredentialPasswordByEmail,
} from './settings';
import type { LocalLoginDecision } from './types';

export async function evaluateLocalLoginByEmail(
  rawEmail: string | null | undefined
): Promise<Result<LocalLoginDecision>> {
  const authMode = await getCurrentAuthMode(SYSTEM_POLICY_CONTEXT);
  if (!authMode.success) {
    return failure(authMode.error);
  }

  const email = normalizeEmail(rawEmail);
  if (!email) {
    return success({
      allowed: true,
      authMode: authMode.data,
      email: null,
      userId: null,
      reason: 'email_missing',
    });
  }

  const profileResult = await getProfileByEmail(email, SYSTEM_POLICY_CONTEXT);
  if (!profileResult.success) {
    return failure(profileResult.error);
  }

  const profile = profileResult.data;
  if (!profile) {
    return success({
      allowed: true,
      authMode: authMode.data,
      email,
      userId: null,
      reason: 'profile_not_found',
    });
  }

  const authSource = (profile.auth_source || '').trim().toLowerCase();
  if (isLocalPasswordAuthSource(authSource)) {
    return success({
      allowed: true,
      authMode: authMode.data,
      email,
      userId: profile.id,
      reason: 'password_account',
    });
  }

  if (authMode.data !== 'degraded') {
    return success({
      allowed: false,
      authMode: authMode.data,
      email,
      userId: profile.id,
      reason: 'blocked_auth_mode',
    });
  }

  if (!profile.local_login_enabled) {
    return success({
      allowed: false,
      authMode: authMode.data,
      email,
      userId: profile.id,
      reason: 'blocked_user_toggle',
    });
  }

  const credentialPassword = await hasCredentialPasswordByEmail(
    email,
    SYSTEM_POLICY_CONTEXT
  );
  if (!credentialPassword.success) {
    return failure(credentialPassword.error);
  }

  if (!credentialPassword.data) {
    return success({
      allowed: false,
      authMode: authMode.data,
      email,
      userId: profile.id,
      reason: 'missing_fallback_password',
    });
  }

  return success({
    allowed: true,
    authMode: authMode.data,
    email,
    userId: profile.id,
    reason: 'allowed_degraded',
  });
}
