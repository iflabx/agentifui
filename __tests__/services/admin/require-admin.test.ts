/** @jest-environment node */
import { requireAdmin } from '@lib/services/admin/require-admin';
import { createClient } from '@lib/supabase/server';

jest.mock('@lib/supabase/server', () => ({
  createClient: jest.fn(),
}));

type MockParams = {
  authError?: Error | null;
  profileError?: Error | null;
  profileRole?: 'admin' | 'user' | null;
  userId?: string | null;
};

const createMockSupabase = ({
  authError = null,
  profileError = null,
  profileRole = 'admin',
  userId = 'user-1',
}: MockParams = {}) => {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: profileRole ? { role: profileRole } : null,
    error: profileError,
  });
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue({ select });

  const getUser = jest.fn().mockResolvedValue({
    data: { user: userId ? { id: userId } : null },
    error: authError,
  });

  return {
    auth: { getUser },
    from,
  };
};

describe('requireAdmin', () => {
  const mockedCreateClient = createClient as jest.MockedFunction<
    typeof createClient
  >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 401 when user is not authenticated', async () => {
    mockedCreateClient.mockResolvedValueOnce(
      createMockSupabase({ userId: null }) as unknown as Awaited<
        ReturnType<typeof createClient>
      >
    );

    const result = await requireAdmin();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected auth failure result');
    expect(result.response.status).toBe(401);
  });

  it('returns 500 when role check query fails', async () => {
    mockedCreateClient.mockResolvedValueOnce(
      createMockSupabase({
        profileError: new Error('db error'),
      }) as unknown as Awaited<ReturnType<typeof createClient>>
    );

    const result = await requireAdmin();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected auth failure result');
    expect(result.response.status).toBe(500);
  });

  it('returns 403 when user role is not admin', async () => {
    mockedCreateClient.mockResolvedValueOnce(
      createMockSupabase({ profileRole: 'user' }) as unknown as Awaited<
        ReturnType<typeof createClient>
      >
    );

    const result = await requireAdmin();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('Expected auth failure result');
    expect(result.response.status).toBe(403);
  });

  it('returns ok=true with userId and client for admin', async () => {
    const supabase = createMockSupabase({
      profileRole: 'admin',
      userId: 'admin-1',
    });
    mockedCreateClient.mockResolvedValueOnce(
      supabase as unknown as Awaited<ReturnType<typeof createClient>>
    );

    const result = await requireAdmin();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('Expected auth success result');
    expect(result.userId).toBe('admin-1');
    expect(result.supabase).toBe(supabase);
  });
});
