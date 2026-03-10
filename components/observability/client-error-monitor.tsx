'use client';

import { reportClientError } from '@lib/services/client/error-reporting';

import { useEffect } from 'react';

function normalizeUnknownReason(reason: unknown): {
  userMessage: string;
  developerMessage?: string;
} {
  if (reason instanceof Error) {
    return {
      userMessage: reason.message || 'Unhandled promise rejection',
      developerMessage: reason.stack || reason.message,
    };
  }

  if (typeof reason === 'string') {
    return {
      userMessage: reason,
    };
  }

  if (reason && typeof reason === 'object') {
    try {
      return {
        userMessage: JSON.stringify(reason).slice(0, 1000),
      };
    } catch {
      return {
        userMessage: 'Unhandled promise rejection',
      };
    }
  }

  return {
    userMessage: 'Unhandled promise rejection',
  };
}

export function ClientErrorMonitor() {
  useEffect(() => {
    const handleWindowError = (event: ErrorEvent) => {
      const error = event.error;
      void reportClientError({
        code: 'CLIENT_WINDOW_ERROR',
        userMessage: event.message || error?.message || 'Unexpected client error',
        developerMessage:
          error instanceof Error
            ? error.stack || error.message
            : [event.filename, event.lineno, event.colno]
                .filter(Boolean)
                .join(':'),
        severity: 'error',
        retryable: true,
        context: {
          filename: event.filename || null,
          lineno: event.lineno || null,
          colno: event.colno || null,
        },
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const normalized = normalizeUnknownReason(event.reason);
      void reportClientError({
        code: 'CLIENT_UNHANDLED_REJECTION',
        userMessage: normalized.userMessage,
        developerMessage: normalized.developerMessage,
        severity: 'error',
        retryable: true,
        context: {
          eventType: 'unhandledrejection',
        },
      });
    };

    window.addEventListener('error', handleWindowError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleWindowError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return null;
}
