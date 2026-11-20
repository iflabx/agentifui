import { render } from '@testing-library/react';

import { ClientErrorMonitor } from '../../components/observability/client-error-monitor';
import { reportClientError } from '../../lib/services/client/error-reporting';

jest.mock('../../lib/services/client/error-reporting', () => ({
  reportClientError: jest.fn().mockResolvedValue(true),
}));

test('unhandled objects never serialize request bodies or invoke their serializer', () => {
  const toJSON = jest.fn(() => 'synthetic-private-serialization');
  const view = render(<ClientErrorMonitor />);
  try {
    const event = new Event('unhandledrejection');
    Object.defineProperty(event, 'reason', {
      value: {
        request: {
          body: {
            prompt: 'synthetic-private-prompt',
            reply: 'synthetic-private-reply',
          },
        },
        toJSON,
      },
    });
    window.dispatchEvent(event);
    expect(reportClientError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'CLIENT_UNHANDLED_REJECTION',
        userMessage: 'Unhandled promise rejection',
        developerMessage: undefined,
      })
    );
    expect(toJSON).not.toHaveBeenCalled();
    expect(
      JSON.stringify(jest.mocked(reportClientError).mock.calls)
    ).not.toContain('synthetic-private');
  } finally {
    view.unmount();
  }
});

test.each([new Error('Synthetic failure'), 'Synthetic failure'])(
  'preserves ordinary error diagnostics for downstream sanitization',
  reason => {
    const view = render(<ClientErrorMonitor />);
    try {
      const event = new Event('unhandledrejection');
      Object.defineProperty(event, 'reason', { value: reason });
      window.dispatchEvent(event);
      expect(reportClientError).toHaveBeenLastCalledWith(
        expect.objectContaining({ userMessage: 'Synthetic failure' })
      );
    } finally {
      view.unmount();
    }
  }
);
