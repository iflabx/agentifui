import { callInternalDataAction } from '@lib/db/internal-data-api';
import type { Conversation } from '@lib/types/database';
import { Result, failure, success } from '@lib/types/result';

type ConversationInput = Omit<Conversation, 'id' | 'created_at' | 'updated_at'>;
type ConversationUpdates = Partial<
  Omit<Conversation, 'id' | 'created_at' | 'updated_at' | 'user_id'>
>;

const CONVERSATION_LOOKUP_CACHE_TTL_MS = 15_000;

type ConversationLookupCacheEntry = {
  expiresAt: number;
  value: Conversation | null;
};

const conversationLookupCache = new Map<string, ConversationLookupCacheEntry>();
const conversationLookupInflight = new Map<
  string,
  Promise<Result<Conversation | null>>
>();

function pruneConversationLookupCache(now: number): void {
  for (const [key, entry] of conversationLookupCache.entries()) {
    if (entry.expiresAt <= now) {
      conversationLookupCache.delete(key);
    }
  }
}

function readConversationLookupCache(
  externalId: string
): Result<Conversation | null> | null {
  const now = Date.now();
  pruneConversationLookupCache(now);

  const cached = conversationLookupCache.get(externalId);
  if (!cached || cached.expiresAt <= now) {
    return null;
  }

  return success(cached.value);
}

function writeConversationLookupCache(
  externalId: string | null | undefined,
  conversation: Conversation | null
): void {
  const normalizedExternalId = externalId?.trim();
  if (!normalizedExternalId) {
    return;
  }

  conversationLookupCache.set(normalizedExternalId, {
    value: conversation,
    expiresAt: Date.now() + CONVERSATION_LOOKUP_CACHE_TTL_MS,
  });
  pruneConversationLookupCache(Date.now());
}

export async function getConversationByExternalId(
  externalId: string
): Promise<Result<Conversation | null>> {
  const normalizedExternalId = externalId.trim();
  if (!normalizedExternalId) {
    return { success: true, data: null };
  }

  const cached = readConversationLookupCache(normalizedExternalId);
  if (cached) {
    return cached;
  }

  const existing = conversationLookupInflight.get(normalizedExternalId);
  if (existing) {
    return existing;
  }

  const requestPromise = callInternalDataAction<Conversation | null>(
    'conversations.getConversationByExternalId',
    {
      externalId: normalizedExternalId,
    }
  )
    .then(result => {
      if (
        !result.success &&
        /(Unauthorized|Forbidden)/i.test(result.error.message)
      ) {
        return success(null);
      }

      if (result.success) {
        writeConversationLookupCache(normalizedExternalId, result.data);
      }

      return result;
    })
    .finally(() => {
      conversationLookupInflight.delete(normalizedExternalId);
    });

  conversationLookupInflight.set(normalizedExternalId, requestPromise);
  return requestPromise;
}

export async function createConversation(
  conversation: ConversationInput
): Promise<Result<Conversation>> {
  const result = await callInternalDataAction<Conversation>(
    'conversations.createConversation',
    {
      conversation,
    }
  );

  if (result.success) {
    writeConversationLookupCache(result.data.external_id, result.data);
  }

  return result;
}

export async function updateConversation(
  conversationId: string,
  updates: ConversationUpdates
): Promise<Result<boolean>> {
  const normalizedConversationId = conversationId.trim();
  const normalizedTitle =
    typeof updates.title === 'string' ? updates.title.trim() : '';

  if (!normalizedConversationId) {
    return failure('Conversation ID is required');
  }

  if (!normalizedTitle) {
    return failure('Only title update is supported in browser runtime');
  }

  return callInternalDataAction<boolean>('conversations.renameConversation', {
    conversationId: normalizedConversationId,
    title: normalizedTitle,
  });
}

export async function renameConversation(
  conversationId: string,
  newTitle: string
): Promise<Result<boolean>> {
  return updateConversation(conversationId, { title: newTitle });
}

export async function deleteConversation(
  conversationId: string
): Promise<Result<boolean>> {
  const normalizedConversationId = conversationId.trim();
  if (!normalizedConversationId) {
    return failure('Conversation ID is required');
  }

  return callInternalDataAction<boolean>('conversations.deleteConversation', {
    conversationId: normalizedConversationId,
  });
}
