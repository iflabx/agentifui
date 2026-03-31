// eslint-disable-next-line @typescript-eslint/no-require-imports -- API runtime needs the JS companion outside apps/api/src rootDir
const { getProtectedTerms } = require('../../../../lib/config/branding.js') as {
  getProtectedTerms: (locale?: string) => string[];
};

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

const PLACEHOLDER_PATTERN = /\{[^}]+\}/g;
const INTERNAL_TOKEN_LEAK_PATTERN =
  /(?:\[\s*\[\s*aifx[\s\w-]*\]\s*\])|(?:__\s*(?:placeholder|term)\s*_\s*\d+\s*__)/i;

function resolveTranslationCode(locale: string): string {
  return LOCALE_CODE_MAP[locale] || locale.split('-')[0] || locale;
}

function isPlainObject(value: JsonValue | unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cloneJsonValue<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function shouldTranslateKey(key: string | undefined, value: string): boolean {
  if (!key || !TRANSLATABLE_KEYS.has(key)) {
    return false;
  }

  return value.trim().length > 0;
}

type ProtectedEntry = {
  token: string;
  original: string;
  pattern: RegExp;
};

function createTransportToken(prefix: 'V' | 'T', index: number): string {
  return `[[AIFX${prefix}${index}X]]`;
}

function buildFlexibleTokenPattern(token: string): RegExp {
  const pattern = token
    .split('')
    .map(char => escapeRegex(char))
    .join('\\s*');

  return new RegExp(pattern, 'gi');
}

function protectPatterns(text: string, pattern: RegExp, prefix: 'V' | 'T') {
  const entries: ProtectedEntry[] = [];
  const protectedText = text.replace(pattern, match => {
    const token = createTransportToken(prefix, entries.length);
    entries.push({
      token,
      original: match,
      pattern: buildFlexibleTokenPattern(token),
    });
    return token;
  });

  return { protectedText, entries };
}

function protectLiteralTerms(text: string, terms: string[]) {
  let protectedText = text;
  const entries: ProtectedEntry[] = [];

  for (const term of terms) {
    const termPattern = new RegExp(escapeRegex(term), 'g');
    protectedText = protectedText.replace(termPattern, match => {
      const token = createTransportToken('T', entries.length);
      entries.push({
        token,
        original: match,
        pattern: buildFlexibleTokenPattern(token),
      });
      return token;
    });
  }

  return { protectedText, entries };
}

function restoreEntries(text: string, entries: ProtectedEntry[]): string {
  return entries.reduce(
    (current, entry) => current.replace(entry.pattern, entry.original),
    text
  );
}

function countOccurrences(text: string, term: string): number {
  const matches = text.match(new RegExp(escapeRegex(term), 'g'));
  return matches?.length ?? 0;
}

function extractPlaceholders(text: string): string[] {
  return text.match(PLACEHOLDER_PATTERN) ?? [];
}

function sortStrings(values: string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertTranslationIntegrity(params: {
  sourceText: string;
  translatedText: string;
  protectedTerms: string[];
}) {
  const { sourceText, translatedText, protectedTerms } = params;

  if (INTERNAL_TOKEN_LEAK_PATTERN.test(translatedText)) {
    throw new Error('Translation leaked internal protected token');
  }

  const sourcePlaceholders = sortStrings(extractPlaceholders(sourceText));
  const translatedPlaceholders = sortStrings(
    extractPlaceholders(translatedText)
  );

  if (
    JSON.stringify(sourcePlaceholders) !==
    JSON.stringify(translatedPlaceholders)
  ) {
    throw new Error('Translation changed protected placeholders');
  }

  for (const term of protectedTerms) {
    const sourceCount = countOccurrences(sourceText, term);
    if (sourceCount === 0) {
      continue;
    }

    if (countOccurrences(translatedText, term) < sourceCount) {
      throw new Error(`Translation lost protected term: ${term}`);
    }
  }
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

  const protectedTerms = getProtectedTerms(targetLocale);
  const placeholderProtected = protectPatterns(text, PLACEHOLDER_PATTERN, 'V');
  const termProtected = protectLiteralTerms(
    placeholderProtected.protectedText,
    protectedTerms
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

  const restoredTerms = restoreEntries(
    payload.responseData.translatedText,
    termProtected.entries
  );
  const restoredText = restoreEntries(
    restoredTerms,
    placeholderProtected.entries
  );

  assertTranslationIntegrity({
    sourceText: text,
    translatedText: restoredText,
    protectedTerms,
  });

  return restoredText;
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

    const translatedText = await translateText({
      text: value,
      sourceLocale,
      targetLocale,
    });

    assertTranslationIntegrity({
      sourceText: value,
      translatedText,
      protectedTerms: getProtectedTerms(targetLocale),
    });

    return translatedText;
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
