'use client';

import {
  sendPhoneOtp,
  verifyPhoneOtp,
} from '@lib/auth/better-auth/http-client';
import { cn } from '@lib/utils';
import { Loader2, MessageSquare, Phone } from 'lucide-react';
import { toast } from 'sonner';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

export default function PhoneAuth() {
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [loading, setLoading] = useState(false);
  const t = useTranslations('pages.auth.phoneLogin');

  const sendOTP = async () => {
    if (!phone.trim()) {
      toast.error(t('errors.phoneRequired'));
      return;
    }

    // validate phone number format (Chinese phone number)
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone.replace(/\D/g, ''))) {
      toast.error(t('errors.phoneInvalid'));
      return;
    }

    setLoading(true);

    try {
      await sendPhoneOtp(`+86${phone}`);

      toast.success(t('success.otpSent'));
      setStep('otp');
    } catch (error) {
      console.error('send OTP failed:', error);
      const errorMessage =
        error instanceof Error ? error.message : t('errors.sendFailed');
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const verifyOTP = async () => {
    if (!otp.trim()) {
      toast.error(t('errors.otpRequired'));
      return;
    }

    if (otp.length !== 6) {
      toast.error(t('errors.otpInvalid'));
      return;
    }

    setLoading(true);

    try {
      await verifyPhoneOtp(`+86${phone}`, otp);

      toast.success(t('success.verifySuccess'));
      window.location.href = '/chat';
    } catch (error) {
      console.error('verify failed:', error);
      const errorMessage =
        error instanceof Error ? error.message : t('errors.verifyFailed');
      toast.error(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  const resendOTP = async () => {
    setStep('phone');
    setOtp('');
    await sendOTP();
  };

  return (
    <div
      className={cn(
        'w-full max-w-md space-y-6 rounded-xl border p-6 font-serif shadow-lg transition-all sm:space-y-8 sm:p-8',
        'border-stone-200 bg-stone-50 dark:border-stone-800 dark:bg-stone-900'
      )}
    >
      <div className="text-center">
        <h2 className="flex items-center justify-center gap-2 bg-gradient-to-r from-stone-700 to-stone-500 bg-clip-text py-1 font-serif text-3xl leading-normal font-bold text-transparent">
          <Phone className="h-6 w-6 text-stone-600" />
          {t('title')}
        </h2>
        <p
          className={cn(
            'mt-2 font-serif text-sm',
            'text-gray-600 dark:text-gray-400'
          )}
        >
          {step === 'phone' ? t('subtitle') : t('otpSubtitle')}
        </p>
      </div>

      <div className="space-y-6">
        {step === 'phone' ? (
          <>
            <div>
              <label
                htmlFor="phone"
                className={cn(
                  'mb-1 block font-serif text-sm font-medium',
                  'text-gray-700 dark:text-gray-300'
                )}
              >
                {t('phoneLabel')}
              </label>
              <div className="flex">
                <span
                  className={cn(
                    'inline-flex items-center rounded-l-lg border border-r-0 px-3 font-serif text-sm',
                    'border-stone-300 bg-stone-100 text-gray-600 dark:border-stone-700 dark:bg-stone-800 dark:text-gray-300'
                  )}
                >
                  +86
                </span>
                <input
                  id="phone"
                  type="tel"
                  placeholder={t('phonePlaceholder')}
                  value={phone}
                  onChange={e =>
                    setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))
                  }
                  className={cn(
                    'block w-full rounded-r-lg border px-4 py-3 font-serif placeholder-stone-400 shadow-sm transition-all focus:border-transparent focus:ring-2 focus:ring-stone-500 focus:outline-none',
                    'border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-800 dark:text-white'
                  )}
                  disabled={loading}
                />
              </div>
            </div>

            <button
              onClick={sendOTP}
              disabled={loading || !phone.trim()}
              className={cn(
                'flex h-12 w-full items-center justify-center gap-2 rounded-lg font-serif text-base transition-all disabled:cursor-not-allowed disabled:opacity-50',
                'bg-gradient-to-r from-stone-700 to-stone-600 text-white shadow-md hover:from-stone-800 hover:to-stone-700 hover:shadow-lg'
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('sendingButton')}
                </>
              ) : (
                <>
                  <MessageSquare className="h-4 w-4" />
                  {t('sendOtpButton')}
                </>
              )}
            </button>
          </>
        ) : (
          <>
            <div>
              <label
                htmlFor="otp"
                className={cn(
                  'mb-1 block font-serif text-sm font-medium',
                  'text-gray-700 dark:text-gray-300'
                )}
              >
                {t('otpLabel')}
              </label>
              <input
                id="otp"
                type="text"
                placeholder={t('otpPlaceholder')}
                value={otp}
                onChange={e =>
                  setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                className={cn(
                  'block w-full rounded-lg border px-4 py-3 text-center font-serif text-lg tracking-widest placeholder-stone-400 shadow-sm transition-all focus:border-transparent focus:ring-2 focus:ring-stone-500 focus:outline-none',
                  'border-stone-300 bg-white dark:border-stone-700 dark:bg-stone-800 dark:text-white'
                )}
                disabled={loading}
                maxLength={6}
              />
              <p
                className={cn(
                  'mt-1 font-serif text-sm',
                  'text-gray-600 dark:text-gray-400'
                )}
              >
                {t('otpSentTo', { phone })}
              </p>
            </div>

            <button
              onClick={verifyOTP}
              disabled={loading || otp.length !== 6}
              className={cn(
                'flex h-12 w-full items-center justify-center gap-2 rounded-lg font-serif text-base transition-all disabled:cursor-not-allowed disabled:opacity-50',
                'bg-gradient-to-r from-stone-700 to-stone-600 text-white shadow-md hover:from-stone-800 hover:to-stone-700 hover:shadow-lg'
              )}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('verifyingButton')}
                </>
              ) : (
                t('verifyButton')
              )}
            </button>

            <button
              onClick={resendOTP}
              disabled={loading}
              className={cn(
                'h-10 w-full rounded-lg border font-serif text-sm transition-all disabled:cursor-not-allowed disabled:opacity-50',
                'border-stone-300 text-gray-700 hover:bg-stone-50 dark:border-stone-700 dark:text-gray-300 dark:hover:bg-stone-800'
              )}
            >
              {t('resendButton')}
            </button>

            <button
              onClick={() => setStep('phone')}
              disabled={loading}
              className={cn(
                'h-10 w-full rounded-lg font-serif text-sm transition-all disabled:cursor-not-allowed disabled:opacity-50',
                'text-gray-600 hover:bg-stone-50 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-stone-800 dark:hover:text-gray-300'
              )}
            >
              {t('changePhoneButton')}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
