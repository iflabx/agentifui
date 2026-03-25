import { sso } from '@better-auth/sso';
import { betterAuth } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { genericOAuth } from 'better-auth/plugins/generic-oauth';
import { phoneNumber } from 'better-auth/plugins/phone-number';

import { sendResetPasswordEmail } from './password-reset';
import { getPhoneNumberPluginOptions } from './phone-otp';
import {
  getAuthRateLimitConfig,
  getAuthSecondaryStorage,
  getAuthSessionConfig,
} from './server/config';
import { BETTER_AUTH_BASE_PATH } from './server/constants';
import { getAuthDatabaseConfig } from './server/database';
import {
  getBaseUrl,
  getSecret,
  getTrustedOrigins,
  isPhoneNumberAuthEnabled,
} from './server/env';
import {
  getAuthProviderIssuer,
  getGenericOAuthProviders,
  getPublicSsoProviders,
  getSsoPluginConfig,
} from './server/providers';

export { getAuthProviderIssuer, getPublicSsoProviders };

export const auth = betterAuth({
  baseURL: getBaseUrl(),
  basePath: BETTER_AUTH_BASE_PATH,
  trustedOrigins: getTrustedOrigins(),
  secret: getSecret(),
  database: getAuthDatabaseConfig(),
  secondaryStorage: getAuthSecondaryStorage(),
  rateLimit: getAuthRateLimitConfig(),
  user: {
    modelName: 'auth_users',
    fields: {
      emailVerified: 'email_verified',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  session: getAuthSessionConfig(),
  account: {
    modelName: 'auth_accounts',
    fields: {
      accountId: 'account_id',
      providerId: 'provider_id',
      userId: 'user_id',
      accessToken: 'access_token',
      refreshToken: 'refresh_token',
      idToken: 'id_token',
      accessTokenExpiresAt: 'access_token_expires_at',
      refreshTokenExpiresAt: 'refresh_token_expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    accountLinking: {
      // Enforce strict `1 UUID = 1 IdP`: disable both implicit and explicit linking.
      enabled: false,
      disableImplicitLinking: true,
    },
  },
  verification: {
    modelName: 'auth_verifications',
    fields: {
      expiresAt: 'expires_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  advanced: {
    database: {
      generateId: 'uuid',
    },
  },
  emailAndPassword: {
    enabled: true,
    sendResetPassword: sendResetPasswordEmail,
    revokeSessionsOnPasswordReset: true,
  },
  plugins: [
    nextCookies(),
    ...(isPhoneNumberAuthEnabled()
      ? [phoneNumber(getPhoneNumberPluginOptions())]
      : []),
    ...(getGenericOAuthProviders().length > 0
      ? [genericOAuth({ config: getGenericOAuthProviders() })]
      : []),
    sso({
      defaultSSO: getSsoPluginConfig(),
    }),
  ],
});
