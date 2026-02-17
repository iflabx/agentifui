import {
  AppRequestError,
  buildAppErrorDetail,
  buildAppErrorEnvelope,
  extractAppErrorDetail,
  extractErrorMessage,
  resolveRequestId,
} from '@lib/errors/app-error';

describe('app-error utilities', () => {
  it('builds compatible error envelope', () => {
    const detail = buildAppErrorDetail({
      status: 503,
      source: 'next-api',
      requestId: 'req_1',
      userMessage: 'Service unavailable',
    });
    const envelope = buildAppErrorEnvelope(detail);

    expect(envelope.success).toBe(false);
    expect(envelope.error).toBe('Service unavailable');
    expect(envelope.app_error.code).toBe('SERVICE_UNAVAILABLE');
    expect(envelope.request_id).toBe('req_1');
  });

  it('extracts message with request id from app_error payload', () => {
    const payload = {
      success: false,
      error: 'raw',
      request_id: 'req_payload',
      app_error: {
        code: 'AUTH_FORBIDDEN',
        source: 'auth',
        severity: 'error',
        retryable: false,
        userMessage: 'Insufficient permissions',
        requestId: 'req_payload',
        occurredAt: new Date().toISOString(),
      },
    };

    const message = extractErrorMessage(payload, 'fallback');
    expect(message).toContain('Insufficient permissions');
    expect(message).toContain('req_payload');
  });

  it('resolves request id from headers', () => {
    const headers = new Headers();
    headers.set('x-request-id', 'req_header');

    expect(resolveRequestId(headers)).toBe('req_header');
  });

  it('extracts detail from payload', () => {
    const payload = {
      app_error: {
        code: 'RATE_LIMITED',
        source: 'dify-proxy',
        severity: 'warn',
        retryable: true,
        userMessage: 'Too many requests',
        requestId: 'req_2',
        occurredAt: new Date().toISOString(),
      },
    };

    const detail = extractAppErrorDetail(payload);
    expect(detail?.code).toBe('RATE_LIMITED');
    expect(detail?.requestId).toBe('req_2');
  });

  it('keeps status and detail in AppRequestError', () => {
    const error = new AppRequestError('failed', 502, null);
    expect(error.status).toBe(502);
    expect(error.message).toBe('failed');
  });
});
