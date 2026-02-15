import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { getRealtimeBrokerStats } from '@lib/server/realtime/redis-broker';
import { realtimeService } from '@lib/services/db/realtime-service';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

async function resolveIdentity(request: Request) {
  const result = await resolveSessionIdentity(request.headers);
  if (!result.success) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Failed to verify session' },
        { status: 500 }
      ),
    };
  }

  if (!result.data) {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      ),
    };
  }

  if (result.data.status !== 'active') {
    return {
      ok: false as const,
      response: NextResponse.json(
        { success: false, error: 'Account is not active' },
        { status: 403 }
      ),
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
      return NextResponse.json(
        { success: false, error: 'Forbidden' },
        { status: 403 }
      );
    }

    const stats = realtimeService.getStats();
    const broker = await getRealtimeBrokerStats();

    return NextResponse.json({
      success: true,
      stats,
      broker,
    });
  } catch (error) {
    console.error('[InternalRealtimeStatsAPI] GET failed:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to get realtime stats' },
      { status: 500 }
    );
  }
}
