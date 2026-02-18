import { nextApiErrorResponse } from '@lib/errors/next-api-error-response';
import { requireAdmin } from '@lib/services/admin/require-admin';
import { encryptApiKey } from '@lib/utils/encryption';

import { NextRequest, NextResponse } from 'next/server';

/**
 * POST handler for encrypting an API key.
 * This endpoint is for admin use only.
 * @param request - The NextRequest object.
 * @returns A NextResponse object with the encrypted key or an error message.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdmin(request.headers);
    if (!authResult.ok) return authResult.response;

    // get request data
    const { apiKey } = await request.json();

    if (!apiKey) {
      return nextApiErrorResponse({
        request,
        status: 400,
        code: 'API_KEY_MISSING',
        userMessage: 'Missing API key',
      });
    }

    // get encryption key from environment variables
    const masterKey = process.env.API_ENCRYPTION_KEY;

    if (!masterKey) {
      console.error('API_ENCRYPTION_KEY environment variable not set');
      return nextApiErrorResponse({
        request,
        status: 500,
        code: 'API_ENCRYPTION_KEY_MISSING',
        userMessage: 'Server configuration error: encryption key not set',
      });
    }

    // encrypt the API key
    const encryptedKey = encryptApiKey(apiKey, masterKey);

    // return the encrypted key
    return NextResponse.json({ encryptedKey });
  } catch (error) {
    console.error('Error encrypting API key:', error);
    return nextApiErrorResponse({
      request,
      status: 500,
      code: 'API_KEY_ENCRYPT_FAILED',
      userMessage: 'Error encrypting API key',
      developerMessage:
        error instanceof Error
          ? error.message
          : 'Unknown API key encrypt error',
    });
  }
}
