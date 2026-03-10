import { auth } from '@lib/auth/better-auth/server';
import {
  createSignedSessionTokenCookie,
  extractCookiePair,
  mergeCookieHeader,
} from '@lib/auth/better-auth/session-cookie';
import { syncSessionIdentitySideEffects } from '@lib/auth/better-auth/session-identity';
import {
  buildManagedCasValidateUrl,
  parseCasServiceResponse,
  resolveManagedCasProfile,
  toManagedCasProviderConfig,
} from '@lib/auth/managed-sso';
import { getManagedSsoProviderForLoginById } from '@lib/auth/managed-sso-server';
import { upsertProfileExternalAttributes } from '@lib/db/user-identities';
import { updateUserProfile } from '@lib/db/users';
import { queryRowsWithPgSystemContext } from '@lib/server/pg/user-context';

import { NextRequest, NextResponse } from 'next/server';

const MANAGED_CAS_PROFILE_AUTH_SOURCE = 'managed-cas';

function getSafeReturnUrl(value: string | null): string {
  return typeof value === 'string' && value.startsWith('/') ? value : '/chat';
}

function getPublicOrigin(request: NextRequest): string {
  const envOrigin =
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim();

  if (envOrigin) {
    try {
      return new URL(envOrigin).origin;
    } catch {}
  }

  const forwardedHost =
    request.headers.get('x-forwarded-host') || request.headers.get('host');
  const forwardedProto =
    request.headers.get('x-forwarded-proto') ||
    request.nextUrl.protocol.replace(':', '');

  if (forwardedHost) {
    return `${forwardedProto || 'http'}://${forwardedHost}`;
  }

  return new URL(request.url).origin;
}

function buildServiceUrl(
  request: NextRequest,
  providerId: string,
  returnUrl: string
): string {
  const serviceUrl = new URL(
    `/api/sso/${providerId}/callback`,
    getPublicOrigin(request)
  );
  serviceUrl.search = '';
  serviceUrl.searchParams.set('returnUrl', returnUrl);
  return serviceUrl.toString();
}

function redirectToLoginError(
  request: NextRequest,
  providerId: string,
  returnUrl: string,
  errorCode: string
) {
  const redirectUrl = new URL('/login', getPublicOrigin(request));
  redirectUrl.searchParams.set('error', errorCode);
  redirectUrl.searchParams.set('provider', providerId);
  redirectUrl.searchParams.set('callback', returnUrl);
  return NextResponse.redirect(redirectUrl);
}

async function resolveManagedCasProvider(providerId: string) {
  const provider = await getManagedSsoProviderForLoginById(providerId);
  if (!provider) {
    return null;
  }

  return toManagedCasProviderConfig(provider);
}

async function resolveAuthUserForManagedCasLogin(input: {
  accountProviderId: string;
  email: string | null;
  fullName: string;
  subject: string;
}) {
  const authContext = await auth.$context;
  const existingAccount =
    await authContext.internalAdapter.findAccountByProviderId(
      input.subject,
      input.accountProviderId
    );

  if (existingAccount) {
    const existingUser = await authContext.internalAdapter.findUserById(
      existingAccount.userId
    );

    if (!existingUser) {
      throw new Error('account_data_inconsistent');
    }

    return {
      authContext,
      user: existingUser,
      existingAccount,
    };
  }

  if (!input.email) {
    throw new Error('invalid_account');
  }

  const existingEmailUser = await authContext.internalAdapter.findUserByEmail(
    input.email,
    {
      includeAccounts: true,
    }
  );

  if (existingEmailUser) {
    throw new Error('account_not_linked');
  }

  const user = await authContext.internalAdapter.createUser({
    email: input.email,
    name: input.fullName,
    emailVerified: true,
  });

  return {
    authContext,
    user,
    existingAccount: null,
  };
}

async function ensureManagedCasAccount(input: {
  accountProviderId: string;
  authContext: Awaited<typeof auth.$context>;
  existingAccount: Awaited<
    ReturnType<
      Awaited<
        typeof auth.$context
      >['internalAdapter']['findAccountByProviderId']
    >
  >;
  subject: string;
  userId: string;
}) {
  if (input.existingAccount) {
    return input.existingAccount;
  }

  return input.authContext.internalAdapter.createAccount({
    accountId: input.subject,
    providerId: input.accountProviderId,
    userId: input.userId,
  });
}

async function syncManagedCasProfileCoreFields(input: {
  userId: string;
  providerId: string;
  employeeNumber: string | null;
}) {
  const profileUpdate = await updateUserProfile(input.userId, {
    auth_source: MANAGED_CAS_PROFILE_AUTH_SOURCE,
    sso_provider_id: input.providerId,
  });

  if (!profileUpdate.success) {
    console.warn(
      '[ManagedCAS] failed to sync profile auth source/provider:',
      profileUpdate.error
    );
    return;
  }

  const employeeNumber = input.employeeNumber?.trim() || null;
  if (!employeeNumber) {
    return;
  }

  try {
    const rows = await queryRowsWithPgSystemContext<{
      current_employee_number: string | null;
      used_by_other: boolean;
    }>(
      `
        SELECT
          p.employee_number AS current_employee_number,
          EXISTS (
            SELECT 1
            FROM profiles other
            WHERE other.id <> $1::uuid
              AND other.employee_number = $2
          ) AS used_by_other
        FROM profiles p
        WHERE p.id = $1::uuid
        LIMIT 1
      `,
      [input.userId, employeeNumber]
    );

    const currentState = rows[0];
    if (!currentState) {
      console.warn('[ManagedCAS] profile missing during employee sync:', {
        userId: input.userId,
      });
      return;
    }

    if (currentState.used_by_other) {
      console.warn(
        '[ManagedCAS] skipped employee number write-back because it is already used by another profile:',
        {
          userId: input.userId,
          employeeNumber,
        }
      );
      return;
    }

    if (
      currentState.current_employee_number &&
      currentState.current_employee_number !== employeeNumber
    ) {
      console.warn(
        '[ManagedCAS] skipped employee number write-back because profile already has a different employee number:',
        {
          userId: input.userId,
          currentEmployeeNumber: currentState.current_employee_number,
          incomingEmployeeNumber: employeeNumber,
        }
      );
      return;
    }

    const employeeUpdate = await updateUserProfile(input.userId, {
      employee_number: employeeNumber,
    });
    if (!employeeUpdate.success) {
      console.warn(
        '[ManagedCAS] failed to sync profile employee number:',
        employeeUpdate.error
      );
    }
  } catch (error) {
    console.warn(
      '[ManagedCAS] failed to inspect profile employee number state:',
      error
    );
  }
}

async function syncManagedCasProfileAttributes(input: {
  providerAccountId: string;
  providerIssuer: string;
  rawAttributes: Record<string, string | string[]>;
  requestHeaders: Headers;
  sessionCookie: string;
  userId: string;
  employeeNumber: string | null;
}) {
  const cookiePair = extractCookiePair(input.sessionCookie);
  const syncHeaders = new Headers(input.requestHeaders);

  if (cookiePair) {
    const mergedCookieHeader = mergeCookieHeader(
      input.requestHeaders.get('cookie'),
      [cookiePair]
    );
    if (mergedCookieHeader) {
      syncHeaders.set('cookie', mergedCookieHeader);
    }
  }

  const syncResult = await syncSessionIdentitySideEffects(syncHeaders);
  if (!syncResult.success) {
    console.warn(
      '[ManagedCAS] post-login identity sync failed:',
      syncResult.error
    );
  }

  const targetUserId =
    syncResult.success && syncResult.data
      ? syncResult.data.userId
      : input.userId;

  const profileSync = await upsertProfileExternalAttributes(
    {
      user_id: targetUserId,
      source_issuer: input.providerIssuer,
      source_provider: input.providerAccountId,
      employee_number: input.employeeNumber,
      attributes: input.rawAttributes,
      raw_profile: input.rawAttributes,
    },
    { useSystemActor: true }
  );

  if (!profileSync.success) {
    console.warn(
      '[ManagedCAS] failed to sync external profile attributes:',
      profileSync.error
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ providerId: string }> }
) {
  const { providerId } = await params;
  const returnUrl = getSafeReturnUrl(
    request.nextUrl.searchParams.get('returnUrl')
  );
  const ticket = request.nextUrl.searchParams.get('ticket');

  if (!ticket) {
    return redirectToLoginError(
      request,
      providerId,
      returnUrl,
      'missing_ticket'
    );
  }

  const providerConfig = await resolveManagedCasProvider(providerId);
  if (!providerConfig) {
    return redirectToLoginError(
      request,
      providerId,
      returnUrl,
      'sso_provider_not_found'
    );
  }

  const serviceUrl = buildServiceUrl(request, providerId, returnUrl);
  const validateUrl = buildManagedCasValidateUrl(
    providerConfig,
    serviceUrl,
    ticket
  );

  let casResponseText = '';
  try {
    const validateResponse = await fetch(validateUrl, {
      method: 'GET',
      redirect: 'follow',
      cache: 'no-store',
    });

    casResponseText = await validateResponse.text();
  } catch (error) {
    console.error('[ManagedCAS] ticket validation request failed:', error);
    return redirectToLoginError(
      request,
      providerId,
      returnUrl,
      'ticket_validation_failed'
    );
  }

  const parsedCasResponse = parseCasServiceResponse(casResponseText);
  const resolvedProfile = resolveManagedCasProfile(
    providerConfig,
    parsedCasResponse
  );

  if (!parsedCasResponse.success || !resolvedProfile) {
    console.error('[ManagedCAS] invalid CAS response:', {
      providerId,
      failureCode: parsedCasResponse.failureCode,
      failureMessage: parsedCasResponse.failureMessage,
    });
    return redirectToLoginError(
      request,
      providerId,
      returnUrl,
      'ticket_validation_failed'
    );
  }

  try {
    const normalizedEmail = resolvedProfile.email?.toLowerCase() || null;
    const { authContext, user, existingAccount } =
      await resolveAuthUserForManagedCasLogin({
        accountProviderId: providerConfig.accountProviderId,
        email: normalizedEmail,
        fullName: resolvedProfile.fullName,
        subject: resolvedProfile.subject,
      });

    await ensureManagedCasAccount({
      accountProviderId: providerConfig.accountProviderId,
      authContext,
      existingAccount,
      subject: resolvedProfile.subject,
      userId: user.id,
    });

    const pendingUserUpdates: Record<string, unknown> = {};
    if (resolvedProfile.fullName && user.name !== resolvedProfile.fullName) {
      pendingUserUpdates.name = resolvedProfile.fullName;
    }
    if (!user.emailVerified) {
      pendingUserUpdates.emailVerified = true;
    }

    if (Object.keys(pendingUserUpdates).length > 0) {
      await authContext.internalAdapter.updateUser(user.id, pendingUserUpdates);
    }

    const session = await authContext.internalAdapter.createSession(
      user.id,
      false
    );
    const sessionCookie = await createSignedSessionTokenCookie({
      authOptions: authContext.options,
      secret: authContext.secret,
      token: session.token,
      rememberMe: true,
      sessionExpiresIn: authContext.sessionConfig.expiresIn,
    });

    const response = NextResponse.redirect(
      new URL(returnUrl, getPublicOrigin(request))
    );
    response.headers.append('set-cookie', sessionCookie);

    await syncManagedCasProfileAttributes({
      providerAccountId: providerConfig.accountProviderId,
      providerIssuer: providerConfig.issuer,
      rawAttributes: resolvedProfile.rawAttributes,
      requestHeaders: new Headers(request.headers),
      sessionCookie,
      userId: user.id,
      employeeNumber: resolvedProfile.employeeNumber,
    });

    await syncManagedCasProfileCoreFields({
      userId: user.id,
      providerId: providerConfig.id,
      employeeNumber: resolvedProfile.employeeNumber,
    });

    return response;
  } catch (error) {
    const errorCode =
      error instanceof Error && error.message
        ? error.message
        : 'sso_callback_failed';
    console.error('[ManagedCAS] callback failed:', {
      providerId,
      error,
    });
    return redirectToLoginError(request, providerId, returnUrl, errorCode);
  }
}
