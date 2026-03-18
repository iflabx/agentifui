'use client';

import { ThemeCard } from '@components/settings';
import { TimezoneSelector } from '@components/settings/appearance/timezone-selector';
import { useSettingsColors } from '@lib/hooks/use-settings-colors';
import { useTheme } from '@lib/hooks/use-theme';
import { useUserTimezone } from '@lib/hooks/use-user-timezone';
import { motion } from 'framer-motion';
import { toast } from 'sonner';

import { useState } from 'react';

import { useTranslations } from 'next-intl';

// Appearance settings page
// Allow users to select theme (light/dark/system)
export default function AppearanceSettingsPage() {
  const { theme, setTheme } = useTheme();
  const { timezone, updateTimezone } = useUserTimezone();
  const { colors } = useSettingsColors();
  const t = useTranslations('pages.settings.appearanceSettings');
  const [, setIsSaving] = useState(false);
  const [, setIsTimezoneUpdating] = useState(false);

  // Handle theme change
  // Currently just updates frontend state, future can be extended to save to user preferences
  const handleThemeChange = (newTheme: string) => {
    setIsSaving(true);

    // Set theme
    setTheme(newTheme);

    // Simulate save delay
    setTimeout(() => {
      setIsSaving(false);
    }, 300);
  };

  // Handle timezone change
  // Use localStorage to store user timezone preference
  const handleTimezoneChange = (newTimezone: string) => {
    setIsTimezoneUpdating(true);

    // Update timezone settings
    const success = updateTimezone(newTimezone);

    if (success) {
      console.log(`[AppearanceSettings] Timezone updated to: ${newTimezone}`);
      toast.success(t('timezoneUpdated'));
    } else {
      console.error(
        `[AppearanceSettings] Failed to update timezone to: ${newTimezone}`
      );
      toast.error(t('timezoneUpdateFailed'));
    }

    // Simulate save delay
    setTimeout(() => {
      setIsTimezoneUpdating(false);
    }, 300);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
    >
      <h1 className="mb-6 font-serif text-2xl font-bold">{t('title')}</h1>

      <div
        className={`w-full space-y-10 ${colors.cardBackground.tailwind} rounded-lg border ${colors.borderColor.tailwind} p-6`}
      >
        {/* Theme selection */}
        <section>
          <h2 className="mb-4 font-serif text-lg font-medium">{t('theme')}</h2>
          <p
            className={`${colors.secondaryTextColor.tailwind} mb-6 font-serif`}
          >
            {t('themeDescription')}
          </p>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            {/* Light theme - put first */}
            <ThemeCard
              title={t('themes.light')}
              theme="light"
              currentTheme={theme || 'system'}
              onClick={() => handleThemeChange('light')}
            />

            {/* System theme */}
            <ThemeCard
              title={t('themes.system')}
              theme="system"
              currentTheme={theme || 'system'}
              onClick={() => handleThemeChange('system')}
            />

            {/* Dark theme */}
            <ThemeCard
              title={t('themes.dark')}
              theme="dark"
              currentTheme={theme || 'system'}
              onClick={() => handleThemeChange('dark')}
            />
          </div>
        </section>

        {/* Timezone settings */}
        <section>
          <h2 className="mb-4 font-serif text-lg font-medium">
            {t('timezone')}
          </h2>
          <p
            className={`${colors.secondaryTextColor.tailwind} mb-6 font-serif`}
          >
            {t('timezoneDescription')}
          </p>

          <TimezoneSelector
            value={timezone}
            onChange={handleTimezoneChange}
            className="max-w-md"
          />
        </section>
      </div>
    </motion.div>
  );
}
