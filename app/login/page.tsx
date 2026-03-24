'use client';

import { LoginForm } from '@components/auth/login-form';
import { motion } from 'framer-motion';
import { AlertTriangle, CheckCircle } from 'lucide-react';

import { useTranslations } from 'next-intl';
import { useSearchParams } from 'next/navigation';

import { Alert, AlertDescription } from '../../components/ui/alert';

export default function LoginPage() {
  const searchParams = useSearchParams();
  const registered = searchParams?.get('registered');
  const resetSuccess = searchParams?.get('reset');
  const oauthError = searchParams?.get('error');
  const t = useTranslations('pages.auth.login');

  // get error message
  const getErrorMessage = (error: string) => {
    switch (error) {
      case 'oauth_failed':
        return t('errors.oauthFailed');
      case 'sso_auth_failed':
      case 'sso_callback_failed':
        return t('errors.ssoCallbackFailed');
      case 'account_not_linked':
        return t('errors.accountNotLinked');
      case 'ticket_validation_failed':
        return t('errors.ticketValidationFailed');
      case 'invalid_employee_number':
        return t('errors.invalidEmployeeNumber');
      case 'user_creation_failed':
        return t('errors.userCreationFailed');
      case 'account_data_inconsistent':
        return t('errors.accountDataInconsistent');
      case 'profile_creation_failed':
        return t('errors.profileCreationFailed');
      case 'sso_provider_not_found':
        return t('errors.ssoProviderNotFound');
      case 'missing_ticket':
        return t('errors.missingTicket');
      case 'account_suspended':
        return t('errors.accountSuspended');
      case 'account_pending':
        return t('errors.accountPending');
      case 'invalid_account':
        return t('errors.invalidAccount');
      case 'profile_check_failed':
        return t('errors.profileCheckFailed');
      case 'profile_not_found':
        return t('errors.profileNotFound');
      case 'permission_check_failed':
        return t('errors.permissionCheckFailed');
      default:
        return t('errors.default');
    }
  };

  return (
    <main className="flex min-h-screen w-full flex-col items-center justify-center gap-4 bg-stone-100 px-4 py-12 font-serif sm:px-6 lg:px-8 dark:bg-stone-800">
      {registered && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Alert className="max-w-md border-l-4 border-stone-300 bg-stone-50 dark:border-stone-600 dark:bg-stone-800/50">
            <CheckCircle className="h-4 w-4 text-stone-600 dark:text-stone-400" />
            <AlertDescription className="font-serif text-stone-700 dark:text-stone-300">
              {t('alerts.registered')}
            </AlertDescription>
          </Alert>
        </motion.div>
      )}
      {resetSuccess === 'success' && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Alert className="max-w-md border-l-4 border-stone-300 bg-stone-50 dark:border-stone-600 dark:bg-stone-800/50">
            <CheckCircle className="h-4 w-4 text-stone-600 dark:text-stone-400" />
            <AlertDescription className="font-serif text-stone-700 dark:text-stone-300">
              {t('alerts.resetSuccess')}
            </AlertDescription>
          </Alert>
        </motion.div>
      )}
      {oauthError && (
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <Alert className="max-w-md border-l-4 border-red-500 bg-red-50 dark:border-red-500 dark:bg-red-900/30">
            <AlertTriangle className="h-4 w-4 text-red-500 dark:text-red-400" />
            <AlertDescription className="font-serif text-red-700 dark:text-red-400">
              {getErrorMessage(oauthError)}
            </AlertDescription>
          </Alert>
        </motion.div>
      )}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="w-full max-w-md"
      >
        <LoginForm />
      </motion.div>
    </main>
  );
}
