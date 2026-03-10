'use client';

import { Button } from '@components/ui/button';
import { signInWithEmailPassword } from '@lib/auth/better-auth/http-client';
import { cn } from '@lib/utils';
import { clearCacheOnLogin } from '@lib/utils/cache-cleanup';
import { Eye, EyeOff } from 'lucide-react';

import { useState } from 'react';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { SocialAuthButtons } from './social-auth-buttons';
import { SSOCard } from './sso-button';

export function LoginForm() {
  const router = useRouter();
  const t = useTranslations('pages.auth.login');

  const ssoOnlyMode = process.env.NEXT_PUBLIC_SSO_ONLY_MODE === 'true';

  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      console.log('[login] start email password login process');

      clearCacheOnLogin();

      await signInWithEmailPassword(formData.email, formData.password, '/chat');

      console.log('[login] email password login success');

      router.push('/chat');
      router.refresh();
    } catch (err: unknown) {
      console.error('[login] email password login failed:', err);
      const errorMessage =
        err instanceof Error ? err.message : t('errors.loginFailed');
      setError(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md space-y-6 rounded-xl border border-stone-200 bg-stone-50 p-6 font-serif shadow-lg transition-all sm:space-y-8 sm:p-8 dark:border-stone-800 dark:bg-stone-900">
      <div className="text-center">
        <h2 className="bg-gradient-to-r from-stone-700 to-stone-500 bg-clip-text py-1 font-serif text-3xl leading-normal font-bold text-transparent">
          {t('title')}
        </h2>
        <p className="mt-2 font-serif text-sm text-gray-600 dark:text-gray-400">
          {t('subtitle')}
        </p>
      </div>

      {error && (
        <div className="rounded-lg border-l-4 border-red-500 bg-red-50 p-4 font-serif text-sm text-red-700 dark:bg-red-900/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Login options area */}
      <div className="space-y-6">
        <SSOCard returnUrl="/chat" hideWhenEmpty={!ssoOnlyMode} />

        {!ssoOnlyMode && (
          <>
            <SocialAuthButtons type="login" redirectTo="/chat" />
          </>
        )}

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-stone-300 dark:border-stone-700" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-stone-50 px-2 font-serif text-gray-500 dark:bg-stone-900 dark:text-gray-400">
              {ssoOnlyMode ? t('orSeparatorSso') : t('orSeparator')}
            </span>
          </div>
        </div>

        <>
          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="space-y-5">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1 block font-serif text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {t('emailLabel')}
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="block w-full rounded-lg border border-stone-300 bg-white px-4 py-3 font-serif placeholder-stone-400 shadow-sm transition-all focus:border-transparent focus:ring-2 focus:ring-stone-500 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-white"
                  placeholder={t('emailPlaceholder')}
                  value={formData.email}
                  onChange={handleChange}
                />
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1 block font-serif text-sm font-medium text-gray-700 dark:text-gray-300"
                >
                  {t('passwordLabel')}
                </label>
                <div className="relative">
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    className="block w-full rounded-lg border border-stone-300 bg-white px-4 py-3 pr-12 font-serif placeholder-stone-400 shadow-sm transition-all focus:border-transparent focus:ring-2 focus:ring-stone-500 focus:outline-none dark:border-stone-700 dark:bg-stone-800 dark:text-white"
                    placeholder={t('passwordPlaceholder')}
                    value={formData.password}
                    onChange={handleChange}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute inset-y-0 right-0 flex items-center pr-3 text-sm leading-5 text-stone-500 transition-colors hover:text-stone-600 focus:outline-none dark:text-stone-400 dark:hover:text-stone-300"
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
              </div>
            </div>

            {!ssoOnlyMode && (
              <div className="flex items-center justify-end">
                <div className="text-sm">
                  <Link
                    href="/forgot-password"
                    className="font-serif font-medium text-stone-700 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300"
                  >
                    {t('forgotPasswordLink')}
                  </Link>
                </div>
              </div>
            )}

            <div>
              <Button
                type="submit"
                isLoading={isLoading}
                className="h-12 w-full font-serif text-base"
                variant="gradient"
              >
                {t('loginButton')}
              </Button>
            </div>
          </form>

          {!ssoOnlyMode && (
            <div className="mt-6 space-y-3 text-center">
              <div>
                <Link
                  href="/phone-login"
                  className="font-serif text-sm font-medium text-stone-600 hover:text-stone-700 hover:underline dark:text-stone-400 dark:hover:text-stone-300"
                >
                  {t('phoneLoginLink')}
                </Link>
              </div>

              <p className="font-serif text-sm text-gray-600 dark:text-gray-400">
                {t('noAccountText')}{' '}
                <Link
                  href="/register"
                  className="font-serif font-medium text-stone-700 hover:text-stone-600 dark:text-stone-400 dark:hover:text-stone-300"
                >
                  {t('registerLink')}
                </Link>
              </p>
            </div>
          )}
        </>
      </div>
    </div>
  );
}
