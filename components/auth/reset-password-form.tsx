'use client';

import {
  getCurrentSession,
  resetPasswordWithToken,
} from '@lib/auth/better-auth/http-client';
import { cn } from '@lib/utils';
import { AlertCircle, ArrowLeft, CheckCircle, Eye, EyeOff } from 'lucide-react';

import { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';

export function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('pages.auth.resetPassword');

  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [isSuccess, setIsSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isTokenValid, setIsTokenValid] = useState<boolean | null>(null);
  useEffect(() => {
    const checkUserSession = async () => {
      try {
        const token =
          searchParams?.get('token') ||
          searchParams?.get('token_hash') ||
          searchParams?.get('reset_token');

        if (token) {
          setIsTokenValid(true);
          return;
        }

        const session = await getCurrentSession();
        if (session?.user?.id) {
          setIsTokenValid(true);
          return;
        }

        setError(t('errors.linkExpired'));
        setIsTokenValid(false);
      } catch {
        setError(t('errors.verifyFailed'));
        setIsTokenValid(false);
      }
    };

    checkUserSession();
  }, [searchParams, t]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));

    if (error) setError('');
  };

  const validateForm = (): boolean => {
    if (!formData.password.trim()) {
      setError(t('errors.passwordRequired'));
      return false;
    }

    if (formData.password.length < 6) {
      setError(t('errors.passwordTooShort'));
      return false;
    }

    if (formData.password !== formData.confirmPassword) {
      setError(t('errors.passwordMismatch'));
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!validateForm()) return;

    setIsLoading(true);
    setError('');

    try {
      const token =
        searchParams?.get('token') ||
        searchParams?.get('token_hash') ||
        searchParams?.get('reset_token') ||
        undefined;
      await resetPasswordWithToken(formData.password, token);

      setIsSuccess(true);
      setTimeout(() => {
        router.push('/login?reset=success');
      }, 3000);
    } catch (err) {
      let mappedError: string | null = null;
      if (err instanceof Error) {
        if (err.message.includes('password')) {
          mappedError = t('errors.passwordWeak');
        } else if (err.message.includes('session')) {
          mappedError = t('errors.sessionExpired');
        }
      }
      const errorMessage =
        mappedError ||
        (err instanceof Error ? err.message : t('errors.resetFailed'));
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  if (isTokenValid === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200 px-4 sm:px-6 lg:px-8">
        <div
          className={cn(
            'w-full max-w-md space-y-6 rounded-xl border p-6 font-serif shadow-lg transition-all sm:space-y-8 sm:p-8',
            'border-stone-200 bg-stone-50 bg-stone-900 dark:border-stone-800'
          )}
        >
          <div className="text-center">
            <div
              className={cn(
                'mx-auto mb-4 flex h-16 w-16 animate-pulse items-center justify-center rounded-full',
                'bg-stone-100 dark:bg-stone-800'
              )}
            >
              <div
                className={cn(
                  'h-8 w-8 rounded-full',
                  'bg-stone-300 dark:bg-stone-600'
                )}
              ></div>
            </div>
            <h2 className="font-serif text-xl font-bold text-stone-900 sm:text-2xl">
              {t('verifying')}
            </h2>
            <p
              className={cn(
                'mt-2 font-serif text-sm',
                'text-gray-600 dark:text-gray-400'
              )}
            >
              {t('verifyingSubtitle')}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (isTokenValid === false) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200 px-4 sm:px-6 lg:px-8">
        <div
          className={cn(
            'w-full max-w-md space-y-6 rounded-xl border p-6 font-serif shadow-lg transition-all sm:space-y-8 sm:p-8',
            'border-stone-200 bg-stone-50 bg-stone-900 dark:border-stone-800'
          )}
        >
          <div className="text-center">
            <div
              className={cn(
                'mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full',
                'bg-stone-100 dark:bg-stone-800'
              )}
            >
              <AlertCircle
                className={cn('h-8 w-8', 'text-stone-600 dark:text-stone-400')}
              />
            </div>
            <h2 className="py-1 font-serif text-xl leading-normal font-bold text-stone-900 sm:text-2xl">
              {t('invalidTitle')}
            </h2>
            <p
              className={cn(
                'mt-2 font-serif text-sm',
                'text-stone-600 dark:text-stone-400'
              )}
            >
              {t('invalidSubtitle')}
            </p>
          </div>

          {error && (
            <div
              className={cn(
                'rounded-lg border-l-4 p-4 font-serif text-sm',
                'border-red-500 bg-red-50 bg-red-900/30 text-red-400 text-red-700 dark:border-red-500'
              )}
            >
              {error}
            </div>
          )}

          <div className="text-center">
            <Link
              href="/forgot-password"
              className={cn(
                'inline-flex items-center font-serif text-sm text-stone-700 transition-colors hover:text-stone-600',
                'text-stone-700 hover:text-stone-300 hover:text-stone-600 dark:text-stone-400'
              )}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              {t('retryReset')}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200 px-4 sm:px-6 lg:px-8">
        <div
          className={cn(
            'w-full max-w-md space-y-6 rounded-xl border p-6 font-serif shadow-lg transition-all sm:space-y-8 sm:p-8',
            'border-stone-200 bg-stone-50 bg-stone-900 dark:border-stone-800'
          )}
        >
          <div className="text-center">
            <div
              className={cn(
                'mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full',
                'bg-stone-100 dark:bg-stone-800'
              )}
            >
              <CheckCircle
                className={cn('h-8 w-8', 'text-stone-600 dark:text-stone-400')}
              />
            </div>
            <h2 className="py-1 font-serif text-xl leading-normal font-bold text-stone-900 sm:text-2xl">
              {t('successTitle')}
            </h2>
            <p
              className={cn(
                'mt-2 font-serif text-sm',
                'text-stone-600 dark:text-stone-400'
              )}
            >
              {t('successSubtitle')}
            </p>
          </div>

          <div
            className={cn(
              'rounded-lg border-l-4 p-4 font-serif text-sm',
              'border-stone-400 bg-stone-50 bg-stone-800/50 text-stone-300 text-stone-700 dark:border-stone-600'
            )}
          >
            <p>{t('successMessage')}</p>
          </div>

          <div className="text-center">
            <Link
              href="/login"
              className={cn(
                'inline-flex items-center font-serif text-sm text-stone-700 transition-colors hover:text-stone-600',
                'text-stone-700 hover:text-stone-300 hover:text-stone-600 dark:text-stone-400'
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
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-stone-100 to-stone-200 px-4 sm:px-6 lg:px-8">
      <div
        className={cn(
          'w-full max-w-md space-y-6 rounded-xl border p-6 font-serif shadow-lg transition-all sm:space-y-8 sm:p-8',
          'border-stone-200 bg-stone-50 bg-stone-900 dark:border-stone-800'
        )}
      >
        <div className="text-center">
          <h2 className="py-1 font-serif text-xl leading-normal font-bold text-stone-900 sm:text-2xl">
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
              'border-red-500 bg-red-50 bg-red-900/30 text-red-400 text-red-700 dark:border-red-500'
            )}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
          <div>
            <label
              htmlFor="password"
              className={cn(
                'mb-1 block font-serif text-sm font-medium',
                'text-stone-700 dark:text-stone-300'
              )}
            >
              {t('passwordLabel')}
            </label>
            <div className="relative">
              <input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={formData.password}
                onChange={handleChange}
                className={cn(
                  'relative block w-full appearance-none rounded-lg border px-3 py-2 pr-12 font-serif placeholder-gray-500 transition-all focus:border-transparent focus:ring-2 focus:ring-stone-500 focus:outline-none',
                  'border-gray-300 bg-stone-800 text-gray-900 text-white dark:border-stone-700'
                )}
                placeholder={t('passwordPlaceholder')}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className={cn(
                  'absolute inset-y-0 right-0 flex items-center pr-3 text-sm leading-5 transition-colors focus:outline-none',
                  'text-stone-500 hover:text-stone-300 hover:text-stone-600 dark:text-stone-400'
                )}
                aria-label={
                  showPassword ? t('hidePassword') : t('showPassword')
                }
              >
                {showPassword ? (
                  <Eye className="h-5 w-5" />
                ) : (
                  <EyeOff className="h-5 w-5" />
                )}
              </button>
            </div>
            {formData.password && (
              <p
                className={cn(
                  'mt-1 font-serif text-xs',
                  'text-stone-500 dark:text-stone-400'
                )}
              >
                {t('passwordHint')}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="confirmPassword"
              className={cn(
                'mb-1 block font-serif text-sm font-medium',
                'text-stone-700 dark:text-stone-300'
              )}
            >
              {t('confirmPasswordLabel')}
            </label>
            <div className="relative">
              <input
                id="confirmPassword"
                name="confirmPassword"
                type={showConfirmPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                value={formData.confirmPassword}
                onChange={handleChange}
                className={cn(
                  'relative block w-full appearance-none rounded-lg border px-3 py-2 pr-12 font-serif placeholder-gray-500 transition-all focus:border-transparent focus:ring-2 focus:ring-stone-500 focus:outline-none',
                  'border-gray-300 bg-stone-800 text-gray-900 text-white dark:border-stone-700'
                )}
                placeholder={t('confirmPasswordPlaceholder')}
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className={cn(
                  'absolute inset-y-0 right-0 flex items-center pr-3 text-sm leading-5 transition-colors focus:outline-none',
                  'text-stone-500 hover:text-stone-300 hover:text-stone-600 dark:text-stone-400'
                )}
                aria-label={
                  showConfirmPassword
                    ? t('hideConfirmPassword')
                    : t('showConfirmPassword')
                }
              >
                {showConfirmPassword ? (
                  <EyeOff className="h-5 w-5" />
                ) : (
                  <Eye className="h-5 w-5" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={
              isLoading ||
              !formData.password ||
              !formData.confirmPassword ||
              !!error
            }
            className="group relative flex w-full justify-center rounded-lg border border-transparent bg-stone-700 px-4 py-2 font-serif text-sm font-medium text-white transition-all hover:bg-stone-800 focus:ring-2 focus:ring-stone-500 focus:ring-offset-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? t('resettingButton') : t('resetButton')}
          </button>
        </form>

        <div className="text-center">
          <Link
            href="/login"
            className={cn(
              'font-serif text-sm transition-colors',
              'text-stone-700 hover:text-stone-300 hover:text-stone-600 dark:text-stone-400'
            )}
          >
            {t('backToLogin')}
          </Link>
        </div>
      </div>
    </div>
  );
}
