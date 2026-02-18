import { getActiveProviders } from '@lib/db/providers';
import { getServiceInstancesByProvider } from '@lib/db/service-instances';
import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';
import { requireAdmin } from '@lib/services/admin/require-admin';

import { NextResponse } from 'next/server';

/**
 * Get admin backend status information
 */
export async function GET(request: Request) {
  try {
    const authResult = await requireAdmin(request.headers);
    if (!authResult.ok) return authResult.response;

    // check if there are active service providers
    const providersResult = await getActiveProviders();

    if (!providersResult.success) {
      return nextApiErrorResponse({
        request,
        status: 500,
        code: 'ADMIN_STATUS_PROVIDERS_READ_FAILED',
        userMessage: 'Cannot get provider information',
        developerMessage:
          providersResult.error?.message ||
          'Unknown provider information retrieval error',
        extra: {
          hasActiveProviders: false,
          hasActiveInstances: false,
        },
      });
    }

    const providers = providersResult.data;
    let hasActiveInstances = false;

    // check if there are configured service instances
    if (providers.length > 0) {
      for (const provider of providers) {
        const instancesResult = await getServiceInstancesByProvider(
          provider.id
        );
        if (instancesResult.success && instancesResult.data.length > 0) {
          hasActiveInstances = true;
          break;
        }
      }
    }

    return NextResponse.json({
      hasActiveProviders: providers.length > 0,
      hasActiveInstances,
      providersCount: providers.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('Failed to get admin status:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      code: 'ADMIN_STATUS_READ_FAILED',
      userMessage: 'Failed to get status information',
      developerMessage:
        error instanceof Error ? error.message : 'Unknown admin status error',
      extra: {
        hasActiveProviders: false,
        hasActiveInstances: false,
      },
    });
  }
}
