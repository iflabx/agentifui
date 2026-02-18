/** @jest-environment node */
import {
  buildApiErrorDetail,
  buildApiErrorEnvelope,
  normalizeLegacyErrorEnvelope,
} from './app-error';

describe('normalizeLegacyErrorEnvelope', () => {
  it('returns payload unchanged for non-error status', () => {
    const payload = { success: true, data: { ok: true } };
    const normalized = normalizeLegacyErrorEnvelope({
      payload,
      statusCode: 200,
      requestId: 'req-1',
      source: 'fastify-api',
    });

    expect(normalized).toBe(payload);
  });

  it('attaches app_error detail to legacy error payload', () => {
    const payload = { success: false, error: 'Unauthorized' };
    const normalized = normalizeLegacyErrorEnvelope({
      payload,
      statusCode: 401,
      requestId: 'req-2',
      source: 'fastify-api',
    }) as Record<string, unknown>;

    expect(normalized.success).toBe(false);
    expect(normalized.error).toBe('Unauthorized');
    expect(normalized.request_id).toBe('req-2');
    expect((normalized.app_error as { code?: string }).code).toBe(
      'AUTH_UNAUTHORIZED'
    );
  });

  it('keeps existing app_error envelope unchanged when request_id exists', () => {
    const detail = buildApiErrorDetail({
      status: 400,
      source: 'internal-data',
      userMessage: 'Missing action',
      requestId: 'req-3',
    });
    const payload = buildApiErrorEnvelope(detail, 'Missing action');

    const normalized = normalizeLegacyErrorEnvelope({
      payload,
      statusCode: 400,
      requestId: 'req-3',
      source: 'fastify-api',
    });

    expect(normalized).toBe(payload);
  });

  it('fills missing request_id when app_error already exists', () => {
    const detail = buildApiErrorDetail({
      status: 400,
      source: 'internal-data',
      userMessage: 'Missing action',
      requestId: 'req-x',
    });
    const payload = {
      success: false,
      error: 'Missing action',
      app_error: detail,
    };

    const normalized = normalizeLegacyErrorEnvelope({
      payload,
      statusCode: 400,
      requestId: 'req-4',
      source: 'fastify-api',
    }) as Record<string, unknown>;

    expect(normalized.request_id).toBe('req-4');
    expect(normalized.app_error).toBe(detail);
  });
});
