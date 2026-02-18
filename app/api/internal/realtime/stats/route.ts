import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';
import { getRealtimeBrokerStats } from '@lib/server/realtime/redis-broker';
import { realtimeService } from '@lib/services/db/realtime-service';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function resolveIdentity(request: Request) {
  const result = await resolveSessionIdentity(request.headers);
  if (!result.success) {
    return {
      ok: false as const,
      response: nextApiErrorResponse({
        request,
        status: 500,
        source: 'auth',
        code: 'AUTH_VERIFY_FAILED',
        userMessage: 'Failed to verify session',
        developerMessage:
          result.error?.message ||
          'resolveSessionIdentity returned unsuccessful result',
      }),
    };
  }

  if (!result.data) {
    return {
      ok: false as const,
      response: nextApiErrorResponse({
        request,
        status: 401,
        source: 'auth',
        code: 'AUTH_UNAUTHORIZED',
        userMessage: 'Unauthorized',
      }),
    };
  }

  if (result.data.status !== 'active') {
    return {
      ok: false as const,
      response: nextApiErrorResponse({
        request,
        status: 403,
        source: 'auth',
        code: 'AUTH_ACCOUNT_INACTIVE',
        userMessage: 'Account is not active',
      }),
    };
  }

  return { ok: true as const, identity: result.data };
}

export async function GET(request: Request) {
  try {
    const auth = await resolveIdentity(request);
    if (!auth.ok) {
      return auth.response;
    }

    if (auth.identity.role !== 'admin') {
      return nextApiErrorResponse({
        request,
        status: 403,
        source: 'auth',
        code: 'AUTH_FORBIDDEN',
        userMessage: 'Forbidden',
      });
    }

    const stats = realtimeService.getStats();
    const subscriptions = realtimeService.listSubscriptions();
    const broker = await getRealtimeBrokerStats();

    return NextResponse.json({
      success: true,
      stats,
      subscriptions,
      broker,
    });
  } catch (error) {
    console.error('[InternalRealtimeStatsAPI] GET failed:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      code: 'INTERNAL_REALTIME_STATS_FAILED',
      userMessage: 'Failed to get realtime stats',
      developerMessage:
        error instanceof Error
          ? error.message
          : 'Unknown realtime stats retrieval error',
    });
  }
}
