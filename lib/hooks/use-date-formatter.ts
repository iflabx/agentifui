import { useMemo } from 'react';

import { useFormatter, useTranslations } from 'next-intl';

import { useUserTimezone } from './use-user-timezone';

// Date formatting options interface
export interface DateFormatOptions {
  includeTime?: boolean;
  style?: 'short' | 'medium' | 'long' | 'full';
  timeStyle?: 'short' | 'medium' | 'long';
  relative?: boolean;
  timezone?: string;
}

// Time greeting options interface
export interface TimeGreetingOptions {
  timezone?: string;
  includeUsername?: boolean;
  username?: string | null;
}

type SupportedDateTimeOptions = {
  year?: 'numeric' | '2-digit';
  month?: 'numeric' | '2-digit' | 'long' | 'short' | 'narrow';
  day?: 'numeric' | '2-digit';
  weekday?: 'long' | 'short' | 'narrow';
  hour?: 'numeric' | '2-digit';
  minute?: 'numeric' | '2-digit';
  second?: 'numeric' | '2-digit';
  timeZoneName?: 'short' | 'long';
  dateStyle?: 'full' | 'long' | 'medium' | 'short';
  timeZone?: string;
};

// Unified date formatter hook
// Provides standardized date/time display, supports timezone and i18n
// Uses the 'common.time' translation path as a global utility
export function useDateFormatter(defaultTimezone?: string) {
  const format = useFormatter();
  const t = useTranslations('common.time');
  const { timezone: userTimezone } = useUserTimezone();

  // Core date formatting function
  const formatDate = useMemo(() => {
    return (
      dateInput: string | Date | null | undefined,
      options: DateFormatOptions = {}
    ): string => {
      // Handle null/undefined/empty input
      if (!dateInput) {
        return t('notRecorded');
      }

      try {
        const date =
          typeof dateInput === 'string' ? new Date(dateInput) : dateInput;

        // Check for invalid date
        if (isNaN(date.getTime())) {
          console.warn('[useDateFormatter] Invalid date:', dateInput);
          return t('invalidDate');
        }

        const timezone = options.timezone || defaultTimezone || userTimezone;

        // Build formatting options compatible with next-intl
        const formatOptions: SupportedDateTimeOptions = {
          timeZone: timezone,
        };

        // Set date style
        switch (options.style) {
          case 'short':
            formatOptions.year = 'numeric';
            formatOptions.month = 'short';
            formatOptions.day = 'numeric';
            break;
          case 'medium':
            formatOptions.year = 'numeric';
            formatOptions.month = 'long';
            formatOptions.day = 'numeric';
            break;
          case 'long':
            formatOptions.year = 'numeric';
            formatOptions.month = 'long';
            formatOptions.day = 'numeric';
            formatOptions.weekday = 'long';
            break;
          case 'full':
            formatOptions.dateStyle = 'full';
            break;
          default:
            // Default to medium style
            formatOptions.year = 'numeric';
            formatOptions.month = 'long';
            formatOptions.day = 'numeric';
        }

        // Add time formatting if requested
        if (options.includeTime) {
          switch (options.timeStyle) {
            case 'short':
              formatOptions.hour = '2-digit';
              formatOptions.minute = '2-digit';
              break;
            case 'medium':
              formatOptions.hour = '2-digit';
              formatOptions.minute = '2-digit';
              formatOptions.second = '2-digit';
              break;
            case 'long':
              formatOptions.hour = '2-digit';
              formatOptions.minute = '2-digit';
              formatOptions.second = '2-digit';
              formatOptions.timeZoneName = 'short'; // Only use next-intl supported values
              break;
            default:
              formatOptions.hour = '2-digit';
              formatOptions.minute = '2-digit';
          }
        }

        return format.dateTime(date, formatOptions);
      } catch (error) {
        console.error('[useDateFormatter] Format failed:', error);
        return typeof dateInput === 'string' ? dateInput : t('formatError');
      }
    };
  }, [format, t, defaultTimezone, userTimezone]);

  // Relative time formatting (e.g., "2 hours ago")
  const formatRelativeTime = useMemo(() => {
    return (
      dateInput: string | Date | null | undefined,
      options: { timezone?: string } = {}
    ): string => {
      if (!dateInput) return t('notRecorded');

      try {
        const date =
          typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
        const now = new Date();

        // If timezone is specified, adjust current time if needed
        if (options.timezone) {
          // Implement timezone adjustment logic here if needed
        }

        return format.relativeTime(date, now);
      } catch (error) {
        console.error('[useDateFormatter] Relative time format failed:', error);
        return formatDate(dateInput, { style: 'short' });
      }
    };
  }, [format, formatDate, t]);

  // Time-based greeting generator
  // This is the core greeting feature, uses 'common.time.greeting' translation path
  // Uses user timezone for greeting calculation
  const getTimeBasedGreeting = useMemo(() => {
    return (options: TimeGreetingOptions = {}): string => {
      try {
        const now = new Date();

        // Get hour in specified timezone, prefer user timezone
        let hour: number;
        const timezone = options.timezone || userTimezone;

        if (timezone) {
          const timeString = new Intl.DateTimeFormat('en', {
            hour: 'numeric',
            hour12: false,
            timeZone: timezone,
          }).format(now);
          hour = parseInt(timeString, 10);
        } else {
          hour = now.getHours();
        }

        // Determine greeting type
        let greetingKey: string;
        if (hour >= 6 && hour < 12) {
          greetingKey = 'morning';
        } else if (hour >= 12 && hour < 18) {
          greetingKey = 'afternoon';
        } else if (hour >= 18 && hour < 22) {
          greetingKey = 'evening';
        } else {
          greetingKey = 'night';
        }

        const greeting = t(`greeting.${greetingKey}`);

        // Add username if provided
        if (options.includeUsername && options.username) {
          return `${greeting}，${options.username}`;
        }

        return greeting;
      } catch (error) {
        console.error('[useDateFormatter] Greeting generation failed:', error);
        return t('greeting.default');
      }
    };
  }, [t, userTimezone]);

  // Format duration (milliseconds to readable string)
  const formatDuration = useMemo(() => {
    return (milliseconds: number): string => {
      if (milliseconds < 1000) {
        return `${milliseconds}ms`;
      }

      const seconds = (milliseconds / 1000).toFixed(1);
      return `${seconds}s`;
    };
  }, []);

  // Get current user timezone
  const getCurrentTimezone = useMemo(() => {
    return (): string => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
      } catch {
        console.warn(
          '[useDateFormatter] cannot get system timezone, use default'
        );
        return 'Asia/Shanghai';
      }
    };
  }, []);

  // Validate if a timezone string is valid
  const isValidTimezone = useMemo(() => {
    return (timezone: string): boolean => {
      try {
        Intl.DateTimeFormat(undefined, { timeZone: timezone });
        return true;
      } catch {
        return false;
      }
    };
  }, []);

  return {
    formatDate,
    formatRelativeTime,
    formatDuration,
    getTimeBasedGreeting,
    getCurrentTimezone,
    isValidTimezone,
  };
}

// Preset commonly used date formatting options
export const DateFormatPresets = {
  // Short date: Jan 15, 2024
  shortDate: { style: 'short' as const },

  // Medium date: January 15, 2024
  mediumDate: { style: 'medium' as const },

  // Long date: Monday, January 15, 2024
  longDate: { style: 'long' as const },

  // Full date: Monday, January 15, 2024
  fullDate: { style: 'full' as const },

  // Date and time: January 15, 2024 14:30
  dateTime: { style: 'medium' as const, includeTime: true },

  // Detailed date and time: January 15, 2024 14:30:25
  detailedDateTime: {
    style: 'medium' as const,
    includeTime: true,
    timeStyle: 'medium' as const,
  },

  // Full date and time with timezone: January 15, 2024 14:30:25 CST
  fullDateTime: {
    style: 'medium' as const,
    includeTime: true,
    timeStyle: 'long' as const,
  },
} as const;
