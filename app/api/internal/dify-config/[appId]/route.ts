import { getDifyAppConfig } from '@lib/config/dify-config';
import { requireAdmin } from '@lib/services/admin/require-admin';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function GET(
  request: Request,
  context: { params: Promise<{ appId: string }> }
) {
  try {
    const authResult = await requireAdmin(request.headers);
    if (!authResult.ok) {
      return authResult.response;
    }

    const { appId } = await context.params;
    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get('forceRefresh') === '1';

    const config = await getDifyAppConfig(appId, forceRefresh);
    return NextResponse.json({
      success: true,
      config,
    });
  } catch (error) {
    console.error('[InternalDifyConfigAPI] failed:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error', config: null },
      { status: 500 }
    );
  }
}
