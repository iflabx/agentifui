import { createClient } from '@lib/supabase/server';

import { NextResponse } from 'next/server';

type ServerSupabaseClient = Awaited<ReturnType<typeof createClient>>;

export type RequireAdminResult =
  | {
      ok: true;
      supabase: ServerSupabaseClient;
      userId: string;
    }
  | {
      ok: false;
      response: NextResponse;
    };

/**
 * Enforce admin access for admin API routes.
 * Returns a typed guard result so handlers can short-circuit consistently.
 */
export async function requireAdmin(): Promise<RequireAdminResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Unauthorized access' },
        { status: 401 }
      ),
    };
  }

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    console.error('[AdminAuth] Failed to verify admin role:', profileError);
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Failed to verify permissions' },
        { status: 500 }
      ),
    };
  }

  if (!profile || profile.role !== 'admin') {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      ),
    };
  }

  return {
    ok: true,
    supabase,
    userId: user.id,
  };
}
