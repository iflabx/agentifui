import { getDifyAppConfig } from '@lib/config/dify-config';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';
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

    const config = await getDifyAppConfig(appId, forceRefresh, {
      actorUserId: authResult.userId,
    });
    return NextResponse.json({
      success: true,
      config,
    });
  } catch (error) {
    console.error('[InternalDifyConfigAPI] failed:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      code: 'INTERNAL_DIFY_CONFIG_FAILED',
      userMessage: 'Internal server error',
      developerMessage:
        error instanceof Error
          ? error.message
          : 'Unknown dify config retrieval error',
      extra: {
        config: null,
      },
    });
  }
}
