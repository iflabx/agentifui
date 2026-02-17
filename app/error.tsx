'use client';

import { AlertTriangle, RefreshCw } from 'lucide-react';

import { useEffect } from 'react';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[AppErrorBoundary] route error:', error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-lg rounded-lg border border-red-200 bg-red-50 p-6 text-red-800">
        <div className="mb-3 flex items-center gap-2">
          <AlertTriangle className="h-5 w-5" />
          <h2 className="text-lg font-semibold">Unexpected error</h2>
        </div>
        <p className="text-sm">
          {error.message ||
            'An unexpected error occurred while rendering page.'}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-100"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    </div>
  );
}
