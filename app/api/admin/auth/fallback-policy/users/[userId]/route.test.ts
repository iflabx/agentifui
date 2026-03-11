/** @jest-environment node */

describe('admin auth fallback policy user route', () => {
  const params = Promise.resolve({
    userId: '00000000-0000-4000-8000-000000000001',
  });

  it('returns 503 for disabled Next business route GET', async () => {
    const { GET } = await import('./route');
    const response = await GET(
      new Request(
        'http://localhost/api/admin/auth/fallback-policy/users/00000000-0000-4000-8000-000000000001'
      ),
      { params }
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('x-agentifui-next-handler')).toBe(
      'next-disabled'
    );
    const payload = await response.json();
    expect(payload.app_error?.code).toBe('NEXT_BUSINESS_ROUTE_DISABLED');
  });

  it('returns 503 for disabled Next business route PATCH', async () => {
    const { PATCH } = await import('./route');
    const response = await PATCH(
      new Request(
        'http://localhost/api/admin/auth/fallback-policy/users/00000000-0000-4000-8000-000000000001',
        {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
          },
          body: JSON.stringify({ localLoginEnabled: 'yes' }),
        }
      ),
      { params }
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('x-agentifui-next-handler')).toBe(
      'next-disabled'
    );
    const payload = await response.json();
    expect(payload.app_error?.code).toBe('NEXT_BUSINESS_ROUTE_DISABLED');
  });
});
