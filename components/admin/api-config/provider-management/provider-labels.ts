'use client';

type TranslationFn = {
  (key: string): string;
  has?: (key: string) => boolean;
};

const PROVIDER_TYPE_FALLBACK_LABELS: Record<string, string> = {
  llm: 'LLM',
  platform: 'Platform',
  embedding: 'Embedding',
  tts: 'TTS',
  stt: 'STT',
  vision: 'Vision',
  multimodal: 'Multimodal',
};

const AUTH_TYPE_FALLBACK_LABELS: Record<string, string> = {
  api_key: 'API Key',
  bearer_token: 'Bearer Token',
  oauth2: 'OAuth 2.0',
  basic_auth: 'Basic Auth',
  none: 'None',
};

const TOKEN_FALLBACK_LABELS: Record<string, string> = {
  api: 'API',
  llm: 'LLM',
  m6: 'M6',
  oauth2: 'OAuth 2.0',
  stt: 'STT',
  tts: 'TTS',
};

function titleCaseToken(token: string): string {
  if (!token) {
    return '';
  }

  const normalized = token.toLowerCase();
  if (TOKEN_FALLBACK_LABELS[normalized]) {
    return TOKEN_FALLBACK_LABELS[normalized];
  }

  return token.charAt(0).toUpperCase() + token.slice(1);
}

function humanizeValue(value: string): string {
  return value.split(/[_-]+/).filter(Boolean).map(titleCaseToken).join(' ');
}

function getTranslatedLabel(
  t: TranslationFn,
  prefix: 'providerTypes' | 'authTypes',
  value: string,
  fallbackLabels: Record<string, string>
): string {
  if (!value) {
    return '';
  }

  const translationKey = `${prefix}.${value}`;
  if (t.has?.(translationKey)) {
    return t(translationKey);
  }

  return fallbackLabels[value] || humanizeValue(value);
}

export function getProviderTypeLabel(t: TranslationFn, value: string): string {
  return getTranslatedLabel(
    t,
    'providerTypes',
    value,
    PROVIDER_TYPE_FALLBACK_LABELS
  );
}

export function getAuthTypeLabel(t: TranslationFn, value: string): string {
  return getTranslatedLabel(t, 'authTypes', value, AUTH_TYPE_FALLBACK_LABELS);
}
