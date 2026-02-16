'use client';

import { UserAvatar } from '@components/ui';
import {
  DateFormatPresets,
  useDateFormatter,
} from '@lib/hooks/use-date-formatter';
import { Profile as ExtendedProfile } from '@lib/hooks/use-profile';
import { updateProfileCache } from '@lib/hooks/use-profile';
import { useProfile } from '@lib/hooks/use-profile';
import { Profile as DatabaseProfile } from '@lib/types/database';
import { cn } from '@lib/utils';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  AtSign,
  Calendar,
  Camera,
  Check,
  Edit3,
  User,
} from 'lucide-react';

import { useCallback, useState } from 'react';

import { useTranslations } from 'next-intl';

import { AvatarModal } from './avatar-modal';

// Profile form component
// Use compact modern design, optimize UI layout and visual effects
// Support field restrictions in SSO mode
interface ProfileFormProps {
  profile: DatabaseProfile &
    ExtendedProfile & {
      auth_last_sign_in_at?: string;
    };
  onSuccess?: () => void;
}

export function ProfileForm({ profile, onSuccess }: ProfileFormProps) {
  const t = useTranslations('pages.settings.profileSettings');
  const { mutate: refreshProfile } = useProfile(); // Add refresh profile function
  const { formatDate } = useDateFormatter();

  // Check if it is SSO single sign-on mode
  // In SSO mode, restrict editing of certain fields
  const isSSOOnlyMode = process.env.NEXT_PUBLIC_SSO_ONLY_MODE === 'true';

  const [formData, setFormData] = useState({
    full_name: profile.full_name || '',
    username: profile.username || '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [showAvatarModal, setShowAvatarModal] = useState(false);

  // Handle avatar update
  const handleAvatarUpdate = useCallback(
    async (avatarUrl: string | null) => {
      setMessage({
        type: 'success',
        text: avatarUrl ? t('avatar.uploadSuccess') : t('avatar.deleteSuccess'),
      });

      // Refresh profile data, so that all components using useProfile can see the latest avatar
      try {
        await refreshProfile();
      } catch (error) {
        console.error('Profile refresh failed:', error);
      }

      // Call success callback, notify parent component
      if (onSuccess) {
        onSuccess();
      }
    },
    [t, refreshProfile, onSuccess]
  );

  // Handle form field changes
  // In SSO mode, prevent modification of the full_name field
  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;

    // In SSO mode, do not allow modification of the full_name field
    if (isSSOOnlyMode && name === 'full_name') {
      return;
    }

    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  // Handle form submission
  // Adjust submitted data based on SSO mode
  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      setIsSubmitting(true);
      setMessage(null);

      // Build update data based on SSO mode
      // In SSO mode, do not update the name and avatar URL
      const updateData: {
        username: string;
        full_name?: string;
      } = {
        username: formData.username,
      };

      if (!isSSOOnlyMode) {
        updateData.full_name = formData.full_name;
      }

      const response = await fetch('/api/internal/profile', {
        method: 'PATCH',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: profile.id,
          updates: updateData,
        }),
      });

      const payload = (await response.json()) as {
        success: boolean;
        profile?: {
          id: string;
          full_name: string | null;
          username: string | null;
          avatar_url: string | null;
          role: DatabaseProfile['role'];
          created_at: string;
          updated_at: string;
          employee_number?: string | null;
          auth_last_sign_in_at?: string | null;
        } | null;
        error?: string;
      };

      if (!response.ok || !payload.success || !payload.profile) {
        throw new Error(payload.error || t('updateFailed'));
      }

      const updatedProfile = payload.profile;
      if (updatedProfile) {
        // Update localStorage cache, ensure that the latest data can be seen immediately on other pages
        // Need type conversion to match the ExtendedProfile interface
        const extendedProfile: ExtendedProfile = {
          ...updatedProfile,
          full_name: updatedProfile.full_name || null,
          username: updatedProfile.username || null,
          avatar_url: updatedProfile.avatar_url || null,
          // Remove organization-related fields
          auth_last_sign_in_at: profile.auth_last_sign_in_at,
        };
        updateProfileCache(extendedProfile, profile.id);

        setMessage({
          type: 'success',
          text: t('profileUpdated'),
        });

        // Call success callback
        if (onSuccess) {
          onSuccess();
        }
      }
    } catch (error: unknown) {
      const messageText =
        error instanceof Error ? error.message : t('updateFailed');
      setMessage({
        type: 'error',
        text: messageText,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Message prompt */}
      {message && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            'flex items-center rounded-lg p-3',
            message.type === 'success'
              ? 'border border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
              : 'border border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
          )}
        >
          {message.type === 'success' ? (
            <Check className="mr-2 h-4 w-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="mr-2 h-4 w-4 flex-shrink-0" />
          )}
          <span className="font-serif text-sm">{message.text}</span>
        </motion.div>
      )}

      {/* User avatar and basic information - compact layout */}
      <div
        className={cn(
          'rounded-lg border p-4',
          'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900'
        )}
      >
        <div className="flex items-center space-x-4">
          {/* User avatar - smaller size */}
          <div className="relative">
            <div
              className="group relative cursor-pointer"
              onClick={() => setShowAvatarModal(true)}
            >
              <UserAvatar
                avatarUrl={profile.avatar_url}
                userName={
                  profile.full_name ||
                  profile.username ||
                  t('avatar.defaultUser')
                }
                size="xl"
                className="h-16 w-16 transition-all duration-300 group-hover:opacity-80"
                alt={t('avatar.userAvatar', {
                  userName:
                    profile.full_name ||
                    profile.username ||
                    t('avatar.defaultUser'),
                })}
              />
              {/* Show edit hint text when hovering */}
              <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 transition-all duration-300 group-hover:opacity-100">
                <span className="text-xs font-medium text-white">
                  {t('avatar.editHover')}
                </span>
              </div>
              {/* Bottom right edit indicator */}
              <div
                className={cn(
                  'absolute right-0 bottom-0 flex h-5 w-5 items-center justify-center rounded-full border shadow-sm transition-all duration-300 group-hover:scale-105',
                  'border-white bg-stone-200 text-stone-600 group-hover:bg-stone-300 dark:border-stone-700 dark:bg-stone-600 dark:text-stone-200 dark:group-hover:bg-stone-500'
                )}
              >
                <Camera className="h-2.5 w-2.5" />
              </div>
            </div>
          </div>

          {/* User basic information - simplified layout */}
          <div className="flex-1">
            <h3
              className={cn(
                'mb-1 font-serif text-lg font-medium',
                'text-stone-900 dark:text-stone-100'
              )}
            >
              {profile.full_name || profile.username || t('status.notSet')}
            </h3>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span
                className={cn(
                  'font-serif',
                  'text-stone-600 dark:text-stone-400'
                )}
              >
                {profile.role === 'admin'
                  ? t('roles.admin')
                  : profile.role === 'manager'
                    ? t('roles.manager')
                    : t('roles.user')}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Account information - compact grid layout */}
      <div
        className={cn(
          'rounded-lg border p-4',
          'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900'
        )}
      >
        <h3
          className={cn(
            'mb-3 font-serif text-base font-medium',
            'text-stone-900 dark:text-stone-100'
          )}
        >
          {t('accountInfo')}
        </h3>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex items-center space-x-2">
            <Calendar
              className={cn('h-4 w-4', 'text-stone-600 dark:text-stone-400')}
            />
            <div>
              <p
                className={cn(
                  'font-serif text-xs',
                  'text-stone-600 dark:text-stone-400'
                )}
              >
                {t('registrationTime')}
              </p>
              <p
                className={cn(
                  'font-serif text-sm',
                  'text-stone-900 dark:text-stone-100'
                )}
              >
                {formatDate(profile.created_at, DateFormatPresets.mediumDate)}
              </p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            <Calendar
              className={cn('h-4 w-4', 'text-stone-600 dark:text-stone-400')}
            />
            <div>
              <p
                className={cn(
                  'font-serif text-xs',
                  'text-stone-600 dark:text-stone-400'
                )}
              >
                {t('lastLogin')}
              </p>
              <p
                className={cn(
                  'font-serif text-sm',
                  'text-stone-900 dark:text-stone-100'
                )}
              >
                {profile.auth_last_sign_in_at
                  ? formatDate(
                      profile.auth_last_sign_in_at,
                      DateFormatPresets.dateTime
                    )
                  : t('status.notRecorded')}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Edit personal information - simplified form */}
      <div
        className={cn(
          'rounded-lg border p-4',
          'border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900'
        )}
      >
        <div className="mb-4 flex items-center">
          <Edit3
            className={cn('mr-2 h-4 w-4', 'text-stone-600 dark:text-stone-400')}
          />
          <h3
            className={cn(
              'font-serif text-base font-medium',
              'text-stone-900 dark:text-stone-100'
            )}
          >
            {isSSOOnlyMode ? t('title') : t('editProfile')}
          </h3>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Full name field */}
          <div className="space-y-1">
            <label
              htmlFor="full_name"
              className={cn(
                'block font-serif text-sm font-medium',
                'text-stone-900 dark:text-stone-100'
              )}
            >
              {t('name')}
            </label>
            {isSSOOnlyMode ? (
              <div
                className={cn(
                  'flex items-center space-x-2 rounded-lg border p-3',
                  'border-stone-200 dark:border-stone-800',
                  'bg-gray-50/50 dark:bg-gray-800/30'
                )}
              >
                <User
                  className={cn(
                    'h-4 w-4',
                    'text-stone-600 dark:text-stone-400'
                  )}
                />
                <span
                  className={cn(
                    'font-serif text-sm',
                    'text-stone-900 dark:text-stone-100'
                  )}
                >
                  {profile.full_name || t('status.notSet')}
                </span>
              </div>
            ) : (
              <div
                className={cn(
                  'flex items-center space-x-2 rounded-lg border p-3 transition-all duration-200',
                  'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800',
                  'focus-within:ring-1 focus-within:ring-stone-500/30'
                )}
              >
                <User
                  className={cn(
                    'h-4 w-4',
                    'text-stone-600 dark:text-stone-400'
                  )}
                />
                <input
                  id="full_name"
                  name="full_name"
                  type="text"
                  value={formData.full_name}
                  onChange={handleChange}
                  className={cn(
                    'w-full bg-transparent font-serif text-sm outline-none',
                    'text-stone-900 dark:text-stone-100'
                  )}
                  placeholder={t('namePlaceholder')}
                />
              </div>
            )}
          </div>

          {/* Username field */}
          <div className="space-y-1">
            <label
              htmlFor="username"
              className={cn(
                'block font-serif text-sm font-medium',
                'text-stone-900 dark:text-stone-100'
              )}
            >
              {t('nickname')}
            </label>
            <div
              className={cn(
                'flex items-center space-x-2 rounded-lg border p-3 transition-all duration-200',
                'border-stone-200 bg-white dark:border-stone-700 dark:bg-stone-800',
                'focus-within:ring-1 focus-within:ring-stone-500/30'
              )}
            >
              <AtSign
                className={cn('h-4 w-4', 'text-stone-600 dark:text-stone-400')}
              />
              <input
                id="username"
                name="username"
                type="text"
                value={formData.username}
                onChange={handleChange}
                className={cn(
                  'w-full bg-transparent font-serif text-sm outline-none',
                  'text-stone-900 dark:text-stone-100'
                )}
                placeholder={t('usernamePlaceholder')}
              />
            </div>
          </div>

          {/* Submit button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className={cn(
              'w-full rounded-lg px-4 py-2.5 font-serif text-sm transition-all duration-200',
              'bg-stone-800 text-white hover:bg-stone-900 dark:bg-stone-600 dark:hover:bg-stone-700',
              'disabled:cursor-not-allowed disabled:opacity-50'
            )}
          >
            {isSubmitting ? t('saving') : t('saveChanges')}
          </button>
        </form>
      </div>

      {/* Avatar modal */}
      <AvatarModal
        isOpen={showAvatarModal}
        onClose={() => setShowAvatarModal(false)}
        currentAvatarUrl={profile.avatar_url}
        userName={
          profile.full_name || profile.username || t('avatar.defaultUser')
        }
        onAvatarUpdate={handleAvatarUpdate}
      />
    </div>
  );
}
