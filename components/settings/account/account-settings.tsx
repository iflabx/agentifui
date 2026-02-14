'use client';

import { getCurrentSession } from '@lib/auth/better-auth/http-client';
import { useLogout } from '@lib/hooks/use-logout';
import { useSettingsColors } from '@lib/hooks/use-settings-colors';
import { cn } from '@lib/utils';
import { motion } from 'framer-motion';
import { AlertCircle, Key, LogOut, Mail } from 'lucide-react';

import { useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';

// Account settings component
// Includes all account-related logic: data loading, state management, logout, etc.
export function AccountSettings() {
  const { colors } = useSettingsColors();
  const { logout } = useLogout();
  const t = useTranslations('pages.settings.accountSettings');
  const tCommon = useTranslations('common.ui');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [authSource, setAuthSource] = useState<string | null>(null);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const router = useRouter();

  // Load user account data
  useEffect(() => {
    async function loadUserAccount() {
      try {
        setIsLoading(true);
        setError(null);

        // Check if user is logged in
        const session = await getCurrentSession();
        const user = session?.user ?? null;
        if (!user) {
          router.push('/login');
          return;
        }

        // Get user email and authentication source
        setUserEmail(user.email || null);
        setAuthSource(t('emailPasswordAuth'));
      } catch (err) {
        console.error('Failed to load user account information:', err);
        setError(err instanceof Error ? err : new Error(t('loadAccountError')));
      } finally {
        setIsLoading(false);
      }
    }

    loadUserAccount();
  }, [router, t]);

  // Handle logout
  const handleLogout = async () => {
    if (showConfirm) {
      try {
        setIsLoggingOut(true);
        await logout();
      } catch (error) {
        console.error('Logout failed:', error);
      } finally {
        setIsLoggingOut(false);
      }
    } else {
      setShowConfirm(true);
    }
  };

  // Cancel logout
  const cancelLogout = () => {
    setShowConfirm(false);
  };

  // Handle error cases
  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        <h1 className="mb-6 font-serif text-2xl font-bold">{t('title')}</h1>

        <div
          className={cn(
            'mb-6 rounded-lg p-6',
            'border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
          )}
        >
          <h2
            className={cn(
              'mb-4 font-serif text-lg font-medium',
              'text-red-800 dark:text-red-200'
            )}
          >
            {t('loadAccountError')}
          </h2>
          <p className="mb-4 font-serif">{error.message}</p>
          <button
            onClick={() => window.location.reload()}
            className={cn(
              'rounded-md px-4 py-2 font-serif transition-colors',
              'bg-red-100 text-red-800 hover:bg-red-200 dark:bg-red-800/50 dark:text-red-200 dark:hover:bg-red-700/50'
            )}
          >
            {t('retry')}
          </button>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <h1 className="mb-6 font-serif text-2xl font-bold">{t('title')}</h1>

      <div className="space-y-8">
        {/* Account information card */}
        {isLoading ? (
          <div
            className={cn(
              'rounded-lg border p-6',
              colors.borderColor.tailwind,
              colors.cardBackground.tailwind
            )}
          >
            <div
              className={cn(
                'mb-6 h-6 w-32',
                colors.skeletonBackground.tailwind,
                'animate-pulse rounded-md'
              )}
            ></div>

            <div className="space-y-6">
              {[1, 2].map(item => (
                <div key={item} className="flex items-center">
                  <div
                    className={cn(
                      'h-10 w-10 rounded-full',
                      colors.skeletonBackground.tailwind,
                      'animate-pulse'
                    )}
                  ></div>
                  <div className="ml-4">
                    <div
                      className={cn(
                        'h-3 w-16',
                        colors.skeletonBackground.tailwind,
                        'animate-pulse rounded-md'
                      )}
                    ></div>
                    <div
                      className={cn(
                        'mt-1 h-4 w-32',
                        colors.skeletonBackground.tailwind,
                        'animate-pulse rounded-md'
                      )}
                    ></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div
            className={cn(
              'rounded-lg border p-6',
              colors.borderColor.tailwind,
              colors.cardBackground.tailwind
            )}
          >
            <h3
              className={cn(
                'mb-4 font-serif text-lg font-medium',
                colors.textColor.tailwind
              )}
            >
              {t('accountInfo')}
            </h3>

            <div className="space-y-4">
              {userEmail && (
                <div className="flex items-center">
                  <div
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-full',
                      colors.buttonBackground.tailwind,
                      colors.borderColor.tailwind,
                      'border'
                    )}
                  >
                    <Mail
                      className={cn(
                        'h-5 w-5',
                        colors.secondaryTextColor.tailwind
                      )}
                    />
                  </div>
                  <div className="ml-4">
                    <p
                      className={cn(
                        'font-serif text-sm',
                        colors.secondaryTextColor.tailwind
                      )}
                    >
                      {t('loginEmail')}
                    </p>
                    <p className={cn('font-serif', colors.textColor.tailwind)}>
                      {userEmail}
                    </p>
                  </div>
                </div>
              )}

              {authSource && (
                <div className="flex items-center">
                  <div
                    className={cn(
                      'flex h-10 w-10 items-center justify-center rounded-full',
                      colors.buttonBackground.tailwind,
                      colors.borderColor.tailwind,
                      'border'
                    )}
                  >
                    <Key
                      className={cn(
                        'h-5 w-5',
                        colors.secondaryTextColor.tailwind
                      )}
                    />
                  </div>
                  <div className="ml-4">
                    <p
                      className={cn(
                        'font-serif text-sm',
                        colors.secondaryTextColor.tailwind
                      )}
                    >
                      {t('authMethod')}
                    </p>
                    <p className={cn('font-serif', colors.textColor.tailwind)}>
                      {authSource}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Security settings card - always displayed */}
        <div
          className={cn(
            'rounded-lg border p-6',
            colors.borderColor.tailwind,
            colors.cardBackground.tailwind
          )}
        >
          <h3
            className={cn(
              'mb-4 font-serif text-lg font-medium',
              colors.textColor.tailwind
            )}
          >
            {t('securitySettings')}
          </h3>

          <div className="space-y-4">
            {/* Logout confirmation prompt */}
            {showConfirm && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn(
                  'flex items-center rounded-lg border p-4',
                  'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
                )}
              >
                <AlertCircle className="mr-2 h-5 w-5 flex-shrink-0" />
                <span className="font-serif">{t('confirmLogout')}</span>
              </motion.div>
            )}

            {/* Logout button */}
            <div className="flex items-center justify-between">
              <div
                className={cn(
                  'flex items-center font-serif',
                  colors.textColor.tailwind
                )}
              >
                <LogOut className="mr-2 h-5 w-5" />
                <span>{t('logoutAccount')}</span>
              </div>

              <div className="flex gap-3">
                {showConfirm && (
                  <button
                    onClick={cancelLogout}
                    className={cn(
                      'rounded-lg px-3 py-2',
                      'transition-all duration-200',
                      'cursor-pointer',
                      'font-serif text-sm',
                      colors.buttonBackground.tailwind,
                      colors.buttonBorder.tailwind,
                      colors.textColor.tailwind,
                      colors.buttonHover.tailwind,
                      'border'
                    )}
                  >
                    {tCommon('cancel')}
                  </button>
                )}

                <button
                  onClick={handleLogout}
                  disabled={isLoggingOut}
                  className={cn(
                    'rounded-lg px-3 py-2',
                    'transition-all duration-200',
                    'cursor-pointer',
                    'font-serif text-sm',
                    showConfirm
                      ? 'bg-red-600 text-white hover:bg-red-700'
                      : `${colors.primaryButtonBackground.tailwind} ${colors.primaryButtonHover.tailwind} ${colors.primaryButtonText.tailwind}`
                  )}
                >
                  {isLoggingOut
                    ? t('loggingOut')
                    : showConfirm
                      ? t('confirmLogoutBtn')
                      : t('logout')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
