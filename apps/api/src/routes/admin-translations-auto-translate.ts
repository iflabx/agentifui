type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
type JsonObject = { [key: string]: JsonValue };

type TranslateTextFn = (params: {
  text: string;
  sourceLocale: string;
  targetLocale: string;
}) => Promise<string>;

type BuildTranslatedLocaleMapParams = {
  sourceData: JsonValue;
  sourceLocale: string;
  targetLocales: string[];
  translatedAt?: string;
  translateText?: TranslateTextFn;
};

const LOCALE_CODE_MAP: Record<string, string> = {
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  'ja-JP': 'ja',
  'de-DE': 'de',
  'fr-FR': 'fr',
  'es-ES': 'es',
  'ru-RU': 'ru',
  'it-IT': 'it',
  'pt-PT': 'pt',
};

const TRANSLATABLE_KEYS = new Set([
  'title',
  'subtitle',
  'description',
  'content',
  'text',
  'prefix',
  'linkText',
  'suffix',
  'alt',
  'caption',
  'buttonText',
  'getStarted',
  'learnMore',
]);

const PROTECTED_TERMS = ['BistuCopilot', 'AgentifUI'];
const PLACEHOLDER_PATTERN = /\{[^}]+\}/g;

function resolveTranslationCode(locale: string): string {
  return LOCALE_CODE_MAP[locale] || locale.split('-')[0] || locale;
}

function isPlainObject(value: JsonValue | unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonValue<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function shouldTranslateKey(key: string | undefined, value: string): boolean {
  if (!key || !TRANSLATABLE_KEYS.has(key)) {
    return false;
  }

  return value.trim().length > 0;
}

function protectPatterns(text: string, pattern: RegExp, prefix: string) {
  const matches: string[] = [];
  const protectedText = text.replace(pattern, match => {
    const token = `__${prefix}_${matches.length}__`;
    matches.push(match);
    return token;
  });

  return { protectedText, matches };
}

function restoreTokens(
  text: string,
  prefix: string,
  matches: string[]
): string {
  return matches.reduce(
    (current, match, index) =>
      current.replace(new RegExp(`__${prefix}_${index}__`, 'g'), match),
    text
  );
}

export async function translateTextViaMyMemory(params: {
  text: string;
  sourceLocale: string;
  targetLocale: string;
}): Promise<string> {
  const { text, sourceLocale, targetLocale } = params;

  if (!text.trim() || sourceLocale === targetLocale) {
    return text;
  }

  const placeholderProtected = protectPatterns(
    text,
    PLACEHOLDER_PATTERN,
    'PLACEHOLDER'
  );

  const termProtected = PROTECTED_TERMS.reduce(
    (current, term, index) => {
      const termPattern = new RegExp(
        term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        'g'
      );
      const protectedText = current.protectedText.replace(
        termPattern,
        `__TERM_${index}__`
      );

      return {
        protectedText,
        matches: [...current.matches, term],
      };
    },
    {
      protectedText: placeholderProtected.protectedText,
      matches: [] as string[],
    }
  );

  const url = new URL('https://api.mymemory.translated.net/get');
  url.searchParams.append('q', termProtected.protectedText);
  url.searchParams.append(
    'langpair',
    `${resolveTranslationCode(sourceLocale)}|${resolveTranslationCode(targetLocale)}`
  );
  url.searchParams.append('de', 'license@iflabx.com');

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      'User-Agent': 'AgentifUI/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Translation API error: HTTP ${response.status} ${response.statusText}`
    );
  }

  const payload = (await response.json()) as {
    responseStatus?: number;
    responseData?: { translatedText?: string };
    responseDetails?: string;
  };

  if (payload.responseStatus !== 200 || !payload.responseData?.translatedText) {
    throw new Error(
      payload.responseDetails || 'Translation API returned invalid payload'
    );
  }

  const restoredTerms = termProtected.matches.reduce(
    (current, term, index) =>
      current.replace(new RegExp(`__TERM_${index}__`, 'g'), term),
    payload.responseData.translatedText
  );

  return restoreTokens(
    restoredTerms,
    'PLACEHOLDER',
    placeholderProtected.matches
  );
}

function normalizeMetadata(
  metadata: JsonObject | undefined,
  targetLocale: string,
  translatedAt: string
): JsonObject {
  return {
    ...(metadata || {}),
    lastModified: translatedAt,
    locale: targetLocale,
  };
}

async function translateNode(params: {
  value: JsonValue;
  sourceLocale: string;
  targetLocale: string;
  translatedAt: string;
  translateText: TranslateTextFn;
  currentKey?: string;
}): Promise<JsonValue> {
  const {
    value,
    sourceLocale,
    targetLocale,
    translatedAt,
    translateText,
    currentKey,
  } = params;

  if (typeof value === 'string') {
    if (!shouldTranslateKey(currentKey, value)) {
      return value;
    }

    return translateText({
      text: value,
      sourceLocale,
      targetLocale,
    });
  }

  if (Array.isArray(value)) {
    const translatedItems = await Promise.all(
      value.map(item =>
        translateNode({
          value: item,
          sourceLocale,
          targetLocale,
          translatedAt,
          translateText,
          currentKey,
        })
      )
    );
    return translatedItems;
  }

  if (!isPlainObject(value)) {
    return value;
  }

  const result: JsonObject = {};

  for (const [key, childValue] of Object.entries(value)) {
    if (key === 'metadata' && isPlainObject(childValue)) {
      result[key] = normalizeMetadata(childValue, targetLocale, translatedAt);
      continue;
    }

    result[key] = await translateNode({
      value: childValue,
      sourceLocale,
      targetLocale,
      translatedAt,
      translateText,
      currentKey: key,
    });
  }

  return result;
}

function normalizeSourceData(params: {
  sourceData: JsonValue;
  sourceLocale: string;
  translatedAt: string;
}): JsonValue {
  const { sourceData, sourceLocale, translatedAt } = params;
  const cloned = cloneJsonValue(sourceData);

  if (!isPlainObject(cloned)) {
    return cloned;
  }

  const metadata = isPlainObject(cloned.metadata) ? cloned.metadata : undefined;
  cloned.metadata = normalizeMetadata(metadata, sourceLocale, translatedAt);

  return cloned;
}

export async function buildTranslatedLocaleMap(
  params: BuildTranslatedLocaleMapParams
): Promise<Record<string, JsonValue>> {
  const {
    sourceData,
    sourceLocale,
    targetLocales,
    translatedAt = new Date().toISOString(),
    translateText = translateTextViaMyMemory,
  } = params;

  const uniqueLocales = Array.from(new Set(targetLocales));
  const result: Record<string, JsonValue> = {
    [sourceLocale]: normalizeSourceData({
      sourceData,
      sourceLocale,
      translatedAt,
    }),
  };

  for (const targetLocale of uniqueLocales) {
    if (targetLocale === sourceLocale) {
      continue;
    }

    result[targetLocale] = await translateNode({
      value: cloneJsonValue(sourceData),
      sourceLocale,
      targetLocale,
      translatedAt,
      translateText,
    });
  }

  return result;
}
