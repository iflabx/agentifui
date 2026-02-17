'use client';

import { AlertOctagon } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body>
        <div className="flex min-h-screen items-center justify-center bg-stone-100 px-4">
          <div className="w-full max-w-lg rounded-lg border border-red-200 bg-white p-6">
            <div className="mb-3 flex items-center gap-2 text-red-700">
              <AlertOctagon className="h-5 w-5" />
              <h2 className="text-lg font-semibold">Application crashed</h2>
            </div>
            <p className="text-sm text-stone-700">
              {error.message || 'Unexpected runtime error'}
            </p>
            <button
              type="button"
              onClick={reset}
              className="mt-4 rounded-md border border-stone-300 px-3 py-2 text-sm text-stone-700 hover:bg-stone-100"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
