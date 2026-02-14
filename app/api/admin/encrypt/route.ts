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
    const authResult = await requireAdmin();
    if (!authResult.ok) return authResult.response;

    // get request data
    const { apiKey } = await request.json();

    if (!apiKey) {
      return NextResponse.json({ error: 'Missing API key' }, { status: 400 });
    }

    // get encryption key from environment variables
    const masterKey = process.env.API_ENCRYPTION_KEY;

    if (!masterKey) {
      console.error('API_ENCRYPTION_KEY environment variable not set');
      return NextResponse.json(
        { error: 'Server configuration error: encryption key not set' },
        { status: 500 }
      );
    }

    // encrypt the API key
    const encryptedKey = encryptApiKey(apiKey, masterKey);

    // return the encrypted key
    return NextResponse.json({ encryptedKey });
  } catch (error) {
    console.error('Error encrypting API key:', error);
    return NextResponse.json(
      { error: 'Error encrypting API key' },
      { status: 500 }
    );
  }
}
