/** @jest-environment node */
import { REQUEST_ID_HEADER } from '@lib/errors/app-error';

import { GET, POST } from './route';

describe('Next internal error-events client route disabled stub', () => {
  it('returns 503 envelope for POST and preserves request id header', async () => {
    const response = await POST(
      new Request('http://localhost/api/internal/error-events/client', {
        method: 'POST',
        headers: {
          'x-request-id': 'next-disabled-client-error-post',
        },
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get('x-agentifui-next-handler')).toBe(
      'next-disabled'
    );
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(
      'next-disabled-client-error-post'
    );
    expect(payload.success).toBe(false);
    expect(payload.app_error?.code).toBe('NEXT_BUSINESS_ROUTE_DISABLED');
    expect(payload.request_id).toBe('next-disabled-client-error-post');
  });

  it('reuses POST behavior for GET', async () => {
    const response = await GET(
      new Request('http://localhost/api/internal/error-events/client', {
        method: 'GET',
      })
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get('x-agentifui-next-handler')).toBe(
      'next-disabled'
    );
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    expect(payload.app_error?.code).toBe('NEXT_BUSINESS_ROUTE_DISABLED');
  });
});
