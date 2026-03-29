'use client';

import { Button } from '@components/ui/button';
import { signInWithSocialProvider } from '@lib/auth/better-auth/http-client';
import { isGitHubSocialLoginEnabled } from '@lib/config/auth-provider-flags';
import { cn } from '@lib/utils';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

const GitHubIcon = ({ className }: { className?: string }) => (
  <svg className={className} fill="currentColor" viewBox="0 0 24 24">
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

interface SocialAuthButtonsProps {
  type?: 'login' | 'register';
  redirectTo?: string;
  className?: string;
}

export function SocialAuthButtons({
  type = 'login',
  redirectTo = '/chat',
  className,
}: SocialAuthButtonsProps) {
  const t = useTranslations('pages.auth.social.github');
  const githubSocialLoginEnabled = isGitHubSocialLoginEnabled();

  const [isLoading, setIsLoading] = useState({
    github: false,
  });
  const [error, setError] = useState('');

  if (!githubSocialLoginEnabled) {
    return null;
  }

  const handleSocialAuth = async (provider: 'github') => {
    setIsLoading(prev => ({ ...prev, [provider]: true }));
    setError('');

    try {
      const result = await signInWithSocialProvider(provider, redirectTo);
      if (!result?.url) {
        throw new Error(t('failed'));
      }

      window.location.href = result.url;
    } catch (err) {
      console.error(`GitHub login failed:`, err);
      const errorMessage = err instanceof Error ? err.message : t('failed');
      setError(errorMessage);
      setIsLoading(prev => ({ ...prev, [provider]: false }));
    }
  };

  return (
    <div className={cn('space-y-3', className)}>
      {error && (
        <div
          className={cn(
            'rounded-lg border-l-4 border-red-500 p-3 font-serif text-sm',
            'bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400'
          )}
        >
          {error}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="lg"
        className={cn(
          'relative flex h-12 w-full cursor-pointer items-center justify-center gap-3 font-serif',
          'border-stone-300 bg-white text-stone-700 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-800 dark:text-white dark:hover:bg-stone-700'
        )}
        onClick={() => handleSocialAuth('github')}
        disabled={isLoading.github}
        isLoading={isLoading.github}
      >
        {!isLoading.github && <GitHubIcon className="h-5 w-5" />}
        {type === 'register' ? t('register') : t('login')}
      </Button>
    </div>
  );
}
