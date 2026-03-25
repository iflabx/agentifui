import { isNonRetryableDatabaseError } from '@lib/services/db/data-service/query-runner';

describe('isNonRetryableDatabaseError', () => {
  it('detects constraint and permission failures', () => {
    expect(
      isNonRetryableDatabaseError(
        new Error('violates unique constraint users_email_key')
      )
    ).toBe(true);
    expect(
      isNonRetryableDatabaseError(
        new Error('permission denied for table profiles')
      )
    ).toBe(true);
  });

  it('keeps transient failures retryable', () => {
    expect(
      isNonRetryableDatabaseError(
        new Error('connection terminated unexpectedly')
      )
    ).toBe(false);
    expect(isNonRetryableDatabaseError(new Error('timeout exceeded'))).toBe(
      false
    );
  });
});
