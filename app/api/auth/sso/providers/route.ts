import { getPublicSsoProviders } from '@lib/auth/better-auth/server';

import { NextResponse } from 'next/server';

export async function GET() {
  try {
    return NextResponse.json({
      providers: getPublicSsoProviders(),
      success: true,
    });
  } catch (error) {
    console.error('[AuthSSOProviders] failed to load providers:', error);
    return NextResponse.json(
      { providers: [], success: false, error: 'Failed to load providers' },
      { status: 500 }
    );
  }
}
