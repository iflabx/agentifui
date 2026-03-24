import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4">
      <div className="w-full max-w-lg rounded-2xl border border-stone-200 bg-white p-8 text-center shadow-sm">
        <p className="text-sm font-medium tracking-[0.3em] text-stone-500 uppercase">
          404
        </p>
        <h1 className="mt-3 text-3xl font-semibold text-stone-900">
          Page not found
        </h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          The page you requested does not exist, or the link is outdated.
        </p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/"
            className="rounded-md bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700"
          >
            Go home
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 transition hover:bg-stone-100"
          >
            Go to login
          </Link>
        </div>
      </div>
    </div>
  );
}
