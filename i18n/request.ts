import { resolveReservedVariablesDeep } from '@lib/config/branding';
import { DEFAULT_LOCALE, isValidLocale } from '@lib/config/language-config';

import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

// Deep merge function to merge fallback messages
function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };

  for (const key in source) {
    if (source.hasOwnProperty(key)) {
      if (
        typeof source[key] === 'object' &&
        source[key] !== null &&
        !Array.isArray(source[key]) &&
        typeof result[key] === 'object' &&
        result[key] !== null &&
        !Array.isArray(result[key])
      ) {
        result[key] = deepMerge(
          result[key] as Record<string, unknown>,
          source[key] as Record<string, unknown>
        );
      } else if (result[key] === undefined) {
        // Only use fallback if key doesn't exist in target
        result[key] = source[key];
      }
    }
  }

  return result;
}

export default getRequestConfig(async () => {
  // Dynamic language configuration: prioritize Cookie, otherwise use default language
  const cookieStore = await cookies();
  const locale = cookieStore.get('NEXT_LOCALE')?.value || DEFAULT_LOCALE;

  const finalLocale = isValidLocale(locale) ? locale : DEFAULT_LOCALE;

  // Load messages with fallback support
  let messages;
  let fallbackMessages;

  try {
    messages = (await import(`../messages/${finalLocale}.json`)).default;
  } catch (error) {
    console.error(
      `Failed to load messages for locale ${finalLocale}, falling back to ${DEFAULT_LOCALE}:`,
      error
    );
    messages = (await import(`../messages/${DEFAULT_LOCALE}.json`)).default;
  }

  // Load English fallback messages for non-English locales
  if (finalLocale !== DEFAULT_LOCALE) {
    try {
      fallbackMessages = (await import(`../messages/${DEFAULT_LOCALE}.json`))
        .default;
      // Merge fallback messages with current locale messages
      messages = deepMerge(messages, fallbackMessages);
    } catch (error) {
      console.error(
        `Failed to load fallback messages for ${DEFAULT_LOCALE}:`,
        error
      );
    }
  }

  const now = new Date();
  messages = resolveReservedVariablesDeep(messages, finalLocale, now);

  return {
    locale: finalLocale,
    messages,
    // Provide unified current time to avoid server-client hydration inconsistencies
    now,
    // Timezone handling: don't hardcode timezone here, let format.dateTime use user's local timezone
  };
});
