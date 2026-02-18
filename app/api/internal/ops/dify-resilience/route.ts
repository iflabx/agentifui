import { getDifyProxyCircuitSnapshot } from '@lib/server/dify/proxy-resilience';
import {
  getDifyProxyResilienceMetricsReport,
  getDifyProxySharedCircuitSnapshot,
} from '@lib/server/dify/proxy-resilience';
import { requireAdmin } from '@lib/services/admin/require-admin';

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const authResult = await requireAdmin(request.headers);
  if (!authResult.ok) {
    return authResult.response;
  }

  const url = new URL(request.url);
  const circuitKey = (url.searchParams.get('circuitKey') || '').trim();

  const [metrics, sharedCircuit] = await Promise.all([
    getDifyProxyResilienceMetricsReport(),
    circuitKey
      ? getDifyProxySharedCircuitSnapshot(circuitKey)
      : Promise.resolve(null),
  ]);

  return NextResponse.json({
    success: true,
    metrics,
    circuit: circuitKey
      ? {
          key: circuitKey,
          local: getDifyProxyCircuitSnapshot(circuitKey),
          shared: sharedCircuit,
        }
      : null,
  });
}
