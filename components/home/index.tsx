'use client';

import { Button } from '@components/ui/button';
import { PageLoader } from '@components/ui/page-loader';
import { usePageContent } from '@lib/hooks/use-page-content';

import { useRouter } from 'next/navigation';

import { HomeDynamic } from './home-dynamic';

export function Home() {
  const router = useRouter();
  const { pageContent, isLoading } = usePageContent({ page: 'home' });

  if (isLoading) {
    return <PageLoader />;
  }

  if (pageContent && pageContent.sections.length > 0) {
    return <HomeDynamic pageContent={pageContent} />;
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4">
      <div className="max-w-md text-center">
        <h1 className="mb-4 text-2xl font-bold text-stone-900 dark:text-stone-100">
          Home Page Not Configured
        </h1>
        <p className="mb-6 text-stone-600 dark:text-stone-400">
          The home page content is not configured. Please configure it in the
          admin panel.
        </p>
        <div className="flex flex-col gap-4 sm:flex-row sm:justify-center">
          <Button
            onClick={() => router.push('/admin/content?tab=home')}
            className="bg-stone-800 text-gray-100 hover:bg-stone-700 dark:bg-stone-600 dark:hover:bg-stone-500"
          >
            Configure Home Page
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push('/about')}
            className="border-stone-400 text-stone-800 hover:bg-stone-200 dark:border-stone-500 dark:text-gray-200 dark:hover:bg-stone-600"
          >
            Go to About Page
          </Button>
        </div>
      </div>
    </div>
  );
}
