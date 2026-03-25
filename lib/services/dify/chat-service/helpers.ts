import {
  AppRequestError,
  extractAppErrorDetail,
  extractErrorMessage,
} from '@lib/errors/app-error';

import { DifyRetrieverResource, DifyUsage } from '../types';

export const extractUsage = (usage: unknown): DifyUsage | undefined => {
  if (
    usage &&
    typeof usage === 'object' &&
    'total_tokens' in usage &&
    typeof (usage as { total_tokens: unknown }).total_tokens === 'number'
  ) {
    return usage as DifyUsage;
  }
  return undefined;
};

export const isRetrieverResource = (
  resource: unknown
): resource is DifyRetrieverResource => {
  if (!resource || typeof resource !== 'object') {
    return false;
  }

  const res = resource as Record<string, unknown>;

  return (
    typeof res.segment_id === 'string' &&
    typeof res.document_id === 'string' &&
    typeof res.document_name === 'string' &&
    typeof res.position === 'number' &&
    typeof res.content === 'string'
  );
};

export const normalizeResources = (value: unknown): DifyRetrieverResource[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRetrieverResource);
};

export const extractRetrieverResources = (
  preferred: unknown,
  fallback: unknown
): DifyRetrieverResource[] => {
  const preferredResources = normalizeResources(preferred);
  return preferredResources.length
    ? preferredResources
    : normalizeResources(fallback);
};

export async function throwAppRequestError(
  response: Response,
  fallbackFromBody: (rawBody: string) => string,
  fallbackFromStatus: () => string
): Promise<never> {
  let rawBody = '';
  try {
    rawBody = await response.text();
  } catch {
    // Ignore error when reading error body
  }
  let parsedBody: unknown = null;
  if (rawBody.trim().length > 0) {
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      parsedBody = null;
    }
  }

  const fallbackMessage =
    rawBody.trim().length > 0
      ? fallbackFromBody(rawBody)
      : fallbackFromStatus();
  const message = extractErrorMessage(parsedBody, fallbackMessage);
  throw new AppRequestError(
    message,
    response.status,
    extractAppErrorDetail(parsedBody)
  );
}
