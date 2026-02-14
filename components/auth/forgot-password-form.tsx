'use client';

import { requestPasswordReset } from '@lib/auth/better-auth/http-client';
import { cn } from '@lib/utils';
import { ArrowLeft, Mail } from 'lucide-react';

import { useState } from 'react';

import { useTranslations } from 'next-intl';
import Link from 'next/link';

export function ForgotPasswordForm() {
  const t = useTranslations('pages.auth.forgotPassword');

  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isEmailSent, setIsEmailSent] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsLoading(true);
    setError('');

    try {
      const redirectUrl = `${window.location.origin}/reset-password`;
      console.log('send reset password email, redirect URL:', redirectUrl);

      await requestPasswordReset(email, redirectUrl);

      console.log('reset email send result: success');

      setIsEmailSent(true);
    } catch (err: unknown) {
      let mappedError: string | null = null;
      if (err instanceof Error) {
        if (err.message.includes('email')) {
          mappedError = t('errors.emailRequired');
        } else if (err.message.toLowerCase().includes('rate')) {
          mappedError = t('errors.rateLimited');
        }
      }
      const errorMessage =
        mappedError ||
        (err instanceof Error ? err.message : t('errors.sendFailed'));
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEmail(e.target.value);
    if (error) setError('');
  };

  if (isEmailSent) {
    return (
      <div
        className={cn(
          'flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200 px-4 sm:px-6 lg:px-8',
          'dark:from-stone-800 dark:to-stone-900'
        )}
      >
        <div
          className={cn(
            'w-full max-w-md space-y-6 rounded-xl border p-6 font-serif shadow-lg transition-all sm:space-y-8 sm:p-8',
            'border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900'
          )}
        >
          <div className="text-center">
            <div
              className={cn(
                'mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full',
                'bg-stone-100 dark:bg-stone-800'
              )}
            >
              <Mail
                className={cn('h-8 w-8', 'text-stone-600 dark:text-stone-400')}
              />
            </div>
            <h2
              className={cn(
                'py-1 font-serif text-xl leading-normal font-bold text-stone-900 sm:text-2xl',
                'dark:bg-gradient-to-r dark:from-stone-700 dark:to-stone-500 dark:bg-clip-text dark:text-transparent'
              )}
            >
              {t('success.title')}
            </h2>
            <p
              className={cn(
                'mt-2 font-serif text-sm',
                'text-stone-600 dark:text-stone-400'
              )}
            >
              {t('success.message', { email })}
            </p>
          </div>

          <div
            className={cn(
              'rounded-lg border-l-4 p-4 font-serif text-sm',
              'border-stone-400 bg-stone-50 text-stone-700 dark:border-stone-600 dark:bg-stone-800/50 dark:text-stone-300'
            )}
          >
            <p>{t('success.instructions')}</p>
            <p className="mt-2">{t('success.noEmail')}</p>
          </div>

          <div className="text-center">
            <Link
              href="/login"
              className={cn(
                'flex items-center justify-center font-serif text-sm transition-colors',
                'text-stone-700 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300'
              )}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('backToLogin')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200 px-4 sm:px-6 lg:px-8',
        'dark:from-stone-800 dark:to-stone-900'
      )}
    >
      <div
        className={cn(
          'w-full max-w-md space-y-6 rounded-xl border p-6 font-serif shadow-lg transition-all sm:space-y-8 sm:p-8',
          'border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900'
        )}
      >
        <div className="text-center">
          <h2
            className={cn(
              'py-1 font-serif text-xl leading-normal font-bold text-stone-900 sm:text-2xl',
              'dark:bg-gradient-to-r dark:from-stone-700 dark:to-stone-500 dark:bg-clip-text dark:text-transparent'
            )}
          >
            {t('title')}
          </h2>
          <p
            className={cn(
              'mt-2 font-serif text-sm',
              'text-stone-600 dark:text-stone-400'
            )}
          >
            {t('subtitle')}
          </p>
        </div>

        {error && (
          <div
            className={cn(
              'rounded-lg border-l-4 p-4 font-serif text-sm',
              'border-red-500 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-900/30 dark:text-red-400'
            )}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
          <div>
            <label
              htmlFor="email"
              className={cn(
                'mb-1 block font-serif text-sm font-medium',
                'text-stone-700 dark:text-stone-300'
              )}
            >
              {t('emailLabel')}
            </label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={handleEmailChange}
              className={cn(
                'relative block w-full appearance-none rounded-lg border px-3 py-2 font-serif placeholder-gray-500 transition-all focus:border-transparent focus:ring-2 focus:ring-stone-500 focus:outline-none',
                'border-gray-300 text-gray-900 dark:border-stone-700 dark:bg-stone-800 dark:text-white'
              )}
              placeholder={t('emailPlaceholder')}
            />
          </div>

          <button
            type="submit"
            disabled={isLoading || !email.trim()}
            className={cn(
              'group relative flex w-full justify-center rounded-lg border border-transparent bg-stone-700 px-4 py-2 font-serif text-sm font-medium text-white transition-all hover:bg-stone-800 focus:ring-2 focus:ring-stone-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50',
              'bg-stone-500 hover:bg-stone-600 dark:bg-stone-800 dark:hover:bg-stone-700'
            )}
          >
            {isLoading ? t('sendingButton') : t('sendButton')}
          </button>
        </form>

        <div className="text-center">
          <Link
            href="/login"
            className={cn(
              'flex items-center justify-center font-serif text-sm transition-colors',
              'text-stone-700 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300'
            )}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('backToLogin')}
          </Link>
        </div>
      </div>
    </div>
  );
}
