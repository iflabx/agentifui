/** @jest-environment node */
import { REQUEST_ID_HEADER } from '@lib/errors/app-error';

import { GET, POST } from './route';

describe('Next internal-data route disabled stub', () => {
  it('returns 503 envelope for POST', async () => {
    const response = await POST(
      new Request('http://localhost/api/internal/data', { method: 'POST' })
    );
    const payload = await response.json();

    expect(response.status).toBe(503);
    expect(response.headers.get('x-agentifui-internal-data-handler')).toBe(
      'next-disabled'
    );
    expect(response.headers.get(REQUEST_ID_HEADER)).toBeTruthy();
    expect(payload.success).toBe(false);
    expect(payload.app_error?.code).toBe('INTERNAL_DATA_NEXT_DISABLED');
  });

  it('reuses POST behavior for GET', async () => {
    const response = await GET(
      new Request('http://localhost/api/internal/data', { method: 'GET' })
    );

    expect(response.status).toBe(503);
    expect(response.headers.get('x-agentifui-internal-data-handler')).toBe(
      'next-disabled'
    );
  });
});
