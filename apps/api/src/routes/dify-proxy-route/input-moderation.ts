import type { FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../../config';
import { isObjectRecord } from './helpers';
import type { DifyProxyRequestContext, DifyProxyTargetConfig } from './types';

const INPUT_MODERATION_TIMEOUT_MS = 5000;

export type InputModerationResult =
  | { outcome: 'skip' }
  | { outcome: 'allow'; categories: string[] }
  | { outcome: 'block'; categories: string[] }
  | { outcome: 'unavailable'; reason: string };

interface ParsedModerationResult {
  isSafe: boolean;
  categories: string[];
}

function parseSafetyLabel(value: string): boolean | null {
  const match = value.match(/^safety:\s*(safe|unsafe)\b/i);
  if (!match) {
    return null;
  }

  return match[1].toLowerCase() === 'safe';
}

function normalizeCategories(value: unknown): string[] {
  const normalizeCategoryItem = (item: string): string =>
    item
      .trim()
      .replace(/^categories?\s*:\s*/i, '')
      .replace(/^[\s"'`[{(]+/, '')
      .replace(/[\s"'`\]})\].,;:!?\u3002\uff1b\uff1a\uff01\uff1f]+$/, '')
      .trim();

  if (Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === 'string')
      .map(normalizeCategoryItem)
      .filter(item => item.length > 0 && item.toLowerCase() !== 'none');
  }

  if (typeof value === 'string') {
    return value
      .split(',')
      .map(normalizeCategoryItem)
      .filter(item => item.length > 0 && item.toLowerCase() !== 'none');
  }

  return [];
}

function parseDirectModerationResult(
  payload: unknown
): ParsedModerationResult | null {
  if (!isObjectRecord(payload)) {
    return null;
  }

  const rawIsSafe =
    typeof payload.is_safe === 'boolean'
      ? payload.is_safe
      : typeof payload.isSafe === 'boolean'
        ? payload.isSafe
        : null;

  if (rawIsSafe === null) {
    return null;
  }

  return {
    isSafe: rawIsSafe,
    categories: normalizeCategories(payload.categories),
  };
}

function parseStatusReasonModerationResult(
  payload: unknown
): ParsedModerationResult | null {
  if (!isObjectRecord(payload)) {
    return null;
  }

  const rawStatus =
    typeof payload.status === 'string'
      ? payload.status.trim().toLowerCase()
      : typeof payload.safety === 'string'
        ? payload.safety.trim().toLowerCase()
        : null;

  if (rawStatus !== 'safe' && rawStatus !== 'unsafe') {
    return null;
  }

  const categoriesValue =
    payload.reason ??
    payload.reasons ??
    payload.categories ??
    payload.category ??
    payload.Categories ??
    payload.Category;

  return {
    isSafe: rawStatus === 'safe',
    categories: normalizeCategories(categoriesValue),
  };
}

function parseLegacyModerationText(
  text: string
): ParsedModerationResult | null {
  const isSafe = parseSafetyLabel(text);
  if (isSafe === null) {
    return null;
  }

  const categoryMatch = text.match(/categories:\s*(.+?)(?:\n|$)/i);
  const categories = categoryMatch ? normalizeCategories(categoryMatch[1]) : [];

  return {
    isSafe,
    categories,
  };
}

function parseLegacyModerationObject(
  payload: unknown
): ParsedModerationResult | null {
  if (!isObjectRecord(payload)) {
    return null;
  }

  const rootCategoriesValue =
    payload.Categories ??
    payload.categories ??
    payload.category ??
    payload.Category;

  for (const [key, value] of Object.entries(payload)) {
    const isSafe = parseSafetyLabel(key);
    if (isSafe === null) {
      continue;
    }

    if (typeof value === 'string') {
      const parsed = parseLegacyModerationText(`${key}\n${value}`);
      if (parsed) {
        return parsed;
      }
      continue;
    }

    if (isObjectRecord(value)) {
      const categoriesValue =
        value.Categories ??
        value.categories ??
        value.category ??
        value.Category ??
        rootCategoriesValue;
      return {
        isSafe,
        categories: normalizeCategories(categoriesValue),
      };
    }

    if (typeof value === 'boolean') {
      return {
        isSafe,
        categories: normalizeCategories(rootCategoriesValue),
      };
    }

    if (Array.isArray(value)) {
      return {
        isSafe,
        categories: normalizeCategories(value),
      };
    }
  }

  return null;
}

function extractBlockingAnswer(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  if (!isObjectRecord(payload)) {
    return null;
  }

  const answerCandidates = [
    payload.answer,
    isObjectRecord(payload.data) ? payload.data.answer : null,
    isObjectRecord(payload.data) && isObjectRecord(payload.data.outputs)
      ? payload.data.outputs.answer
      : null,
    isObjectRecord(payload.outputs) ? payload.outputs.answer : null,
  ];

  for (const candidate of answerCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  return null;
}

function parseModerationResponse(
  payload: unknown
): ParsedModerationResult | null {
  const direct = parseDirectModerationResult(payload);
  if (direct) {
    return direct;
  }

  const statusReason = parseStatusReasonModerationResult(payload);
  if (statusReason) {
    return statusReason;
  }

  const legacyObject = parseLegacyModerationObject(payload);
  if (legacyObject) {
    return legacyObject;
  }

  const answer = extractBlockingAnswer(payload);
  if (!answer) {
    return null;
  }

  try {
    const parsedAnswer = JSON.parse(answer);
    const structured = parseDirectModerationResult(parsedAnswer);
    if (structured) {
      return structured;
    }

    const statusReasonStructured =
      parseStatusReasonModerationResult(parsedAnswer);
    if (statusReasonStructured) {
      return statusReasonStructured;
    }

    const legacyStructured = parseLegacyModerationObject(parsedAnswer);
    if (legacyStructured) {
      return legacyStructured;
    }
  } catch {
    // Fall through to legacy text parsing.
  }

  return parseLegacyModerationText(answer);
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function shouldModerateRequest(method: string, slug: string[]): boolean {
  if (method.toUpperCase() !== 'POST') {
    return false;
  }

  const slugPath = slug.join('/');
  return slugPath === 'chat-messages' || slugPath === 'completion-messages';
}

export function extractModerationText(rawBody: unknown): string | null {
  if (!isObjectRecord(rawBody)) {
    return null;
  }

  if (typeof rawBody.query === 'string' && rawBody.query.trim().length > 0) {
    return rawBody.query.trim();
  }

  if (
    isObjectRecord(rawBody.inputs) &&
    typeof rawBody.inputs.query === 'string' &&
    rawBody.inputs.query.trim().length > 0
  ) {
    return rawBody.inputs.query.trim();
  }

  return null;
}

export async function runInputModeration(input: {
  request: FastifyRequest;
  config: ApiRuntimeConfig;
  context: DifyProxyRequestContext;
  targetConfig: DifyProxyTargetConfig;
}): Promise<InputModerationResult> {
  const { request, config, context, targetConfig } = input;

  if (!config.inputModeration.enabled || !config.inputModeration.app) {
    return { outcome: 'skip' };
  }

  if (!shouldModerateRequest(request.method, context.slug)) {
    return { outcome: 'skip' };
  }

  const text = extractModerationText(targetConfig.rawBody);
  if (!text) {
    return { outcome: 'skip' };
  }

  const moderationUrl = `${config.inputModeration.app.apiUrl.replace(/\/+$/, '')}/chat-messages`;

  try {
    const response = await fetchWithTimeout(
      moderationUrl,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${config.inputModeration.app.apiKey}`,
        },
        redirect: 'manual',
        cache: 'no-store',
        body: JSON.stringify({
          inputs: {},
          query: text,
          response_mode: 'blocking',
          user: context.actor.userId,
          conversation_id: '',
        }),
      },
      INPUT_MODERATION_TIMEOUT_MS
    );

    const responseText = await response.text();
    if (!response.ok) {
      request.log.warn(
        {
          appId: context.appId,
          route: context.routePath,
          moderationStatus: response.status,
          moderationBody: responseText.slice(0, 240),
        },
        '[FastifyDifyProxy] input moderation request failed'
      );
      return {
        outcome: 'unavailable',
        reason: `Moderation upstream returned HTTP ${response.status}`,
      };
    }

    const parsedPayload = (() => {
      try {
        return JSON.parse(responseText);
      } catch {
        return responseText;
      }
    })();

    const result = parseModerationResponse(parsedPayload);
    if (!result) {
      request.log.warn(
        {
          appId: context.appId,
          route: context.routePath,
          moderationBody: responseText.slice(0, 240),
        },
        '[FastifyDifyProxy] input moderation response could not be parsed'
      );
      return {
        outcome: 'unavailable',
        reason: 'Moderation response format is invalid',
      };
    }

    return result.isSafe
      ? { outcome: 'allow', categories: result.categories }
      : { outcome: 'block', categories: result.categories };
  } catch (error) {
    request.log.warn(
      {
        appId: context.appId,
        route: context.routePath,
        err: error,
      },
      '[FastifyDifyProxy] input moderation request errored'
    );

    return {
      outcome: 'unavailable',
      reason:
        error instanceof Error && error.name === 'AbortError'
          ? 'Moderation request timed out'
          : error instanceof Error
            ? error.message
            : 'Unknown moderation request error',
    };
  }
}
