'use client';

import { Button } from '@components/ui/button';
import { signInWithSsoProvider } from '@lib/auth/better-auth/http-client';
import { cn } from '@lib/utils';
import { clearCacheOnLogin } from '@lib/utils/cache-cleanup';

import { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

interface SSOButtonProps {
  returnUrl?: string;
  className?: string;
  variant?: 'gradient' | 'outline' | 'secondary';
  size?: 'default' | 'sm' | 'lg';
  disabled?: boolean;
  children?: React.ReactNode;
  providerId?: string;
  authFlow?: 'better-auth' | 'managed-cas';
}

interface BetterAuthSsoProvider {
  providerId: string;
  domain: string;
  displayName: string;
  icon: string;
  mode: 'native' | 'cas-bridge' | 'managed-cas';
  authFlow: 'better-auth' | 'managed-cas';
  description?: string | null;
}

export function SSOButton({
  returnUrl,
  className,
  variant = 'gradient',
  size = 'default',
  disabled = false,
  children,
  providerId,
  authFlow = 'better-auth',
}: SSOButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const t = useTranslations('pages.auth.sso');

  const handleSSOLogin = async () => {
    try {
      setIsLoading(true);

      clearCacheOnLogin();
      if (!providerId) {
        throw new Error(t('noProvider'));
      }

      const callbackURL =
        typeof returnUrl === 'string' && returnUrl.startsWith('/')
          ? returnUrl
          : '/chat';

      if (authFlow === 'managed-cas') {
        const loginUrl = new URL(
          `/api/sso/${encodeURIComponent(providerId)}/login`,
          window.location.origin
        );
        loginUrl.searchParams.set('returnUrl', callbackURL);
        window.location.href = loginUrl.toString();
        return;
      }

      const result = await signInWithSsoProvider(
        providerId,
        callbackURL,
        '/login?error=sso_auth_failed'
      );

      if (!result?.url) {
        throw new Error(t('startError'));
      }

      window.location.href = result.url;
    } catch (error) {
      console.error('[SSO login] failed to start SSO login:', error);
      setIsLoading(false);

      alert(t('startError'));
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={cn(
        'relative flex w-full items-center justify-center gap-2 font-serif',
        className
      )}
      disabled={disabled || isLoading}
      onClick={handleSSOLogin}
    >
      {isLoading && (
        <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
            fill="none"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      )}

      {isLoading ? t('jumpingButton') : children || t('button')}
    </Button>
  );
}

export function SSOCard({
  returnUrl,
  className,
  hideWhenEmpty = false,
}: {
  returnUrl?: string;
  className?: string;
  hideWhenEmpty?: boolean;
}) {
  const [providers, setProviders] = useState<BetterAuthSsoProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const t = useTranslations('pages.auth.sso');

  useEffect(() => {
    const fetchProviders = async () => {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch('/api/auth/sso/providers', {
          method: 'GET',
          cache: 'no-store',
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error(`Failed to load providers (${response.status})`);
        }

        const payload = (await response.json()) as {
          providers?: BetterAuthSsoProvider[];
          success?: boolean;
          error?: string;
        };

        if (!payload.success) {
          throw new Error(payload.error || t('startError'));
        }

        const sortedProviders = (payload.providers || []).sort((a, b) => {
          return a.displayName.localeCompare(b.displayName);
        });

        setProviders(sortedProviders);
      } catch (err) {
        console.error('Error fetching SSO providers:', err);
        setError(err instanceof Error ? err.message : t('startError'));
      } finally {
        setLoading(false);
      }
    };

    fetchProviders();
  }, [t]);

  if (loading) {
    return (
      <div
        className={cn(
          'rounded-lg border p-6 shadow-sm',
          'font-serif transition-shadow hover:shadow-md',
          'border-gray-200 bg-white dark:border-stone-700 dark:bg-stone-800 dark:shadow-stone-900/30',
          className
        )}
      >
        <div className="space-y-4 text-center">
          <Button variant="outline" disabled className="w-full">
            <svg className="mr-2 h-4 w-4 animate-spin" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            {t('processing.processing')}
          </Button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div
        className={cn(
          'rounded-lg border p-6 shadow-sm',
          'font-serif transition-shadow hover:shadow-md',
          'border-gray-200 bg-white dark:border-stone-700 dark:bg-stone-800 dark:shadow-stone-900/30',
          className
        )}
      >
        <div className="space-y-4 text-center">
          <div className="text-sm text-red-600">{error}</div>
        </div>
      </div>
    );
  }

  if (providers.length === 0) {
    if (hideWhenEmpty) {
      return null;
    }

    return (
      <div
        className={cn(
          'rounded-lg border p-6 shadow-sm',
          'font-serif transition-shadow hover:shadow-md',
          'border-gray-200 bg-white dark:border-stone-700 dark:bg-stone-800 dark:shadow-stone-900/30',
          className
        )}
      >
        <div className="space-y-4 text-center">
          <div className={cn('text-sm', 'text-gray-500 dark:text-stone-400')}>
            {t('noProvider')}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'rounded-lg border p-6 shadow-sm',
        'font-serif transition-shadow hover:shadow-md',
        'border-gray-200 bg-white dark:border-stone-700 dark:bg-stone-800 dark:shadow-stone-900/30',
        className
      )}
    >
      <div className="space-y-4 text-center">
        <div>
          <h3
            className={cn(
              'font-serif text-lg font-semibold',
              'text-gray-900 dark:text-stone-100'
            )}
          >
            {t('title')}
          </h3>
          <p
            className={cn(
              'mt-1 font-serif text-sm',
              'text-gray-600 dark:text-stone-300'
            )}
          >
            {t('subtitle')}
          </p>
        </div>

        <div className="space-y-3">
          {providers.map(provider => {
            return (
              <SSOButton
                key={provider.providerId}
                returnUrl={returnUrl}
                providerId={provider.providerId}
                authFlow={provider.authFlow}
                variant="gradient"
                className="w-full font-serif"
              >
                <span className="mr-2">{provider.icon}</span>
                {provider.displayName}
              </SSOButton>
            );
          })}
        </div>

        {/* Help information */}
        <div
          className={cn(
            'font-serif text-xs',
            'text-gray-500 dark:text-stone-400'
          )}
        >
          <p>{t('helpText')}</p>
          <p>{t('contactText')}</p>
        </div>
      </div>
    </div>
  );
}
