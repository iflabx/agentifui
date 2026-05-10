'use client';

import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import {
  createConversation,
  syncGeneratedTitleIfPlaceholder,
  updateConversation,
} from '@lib/services/client/conversations-api';
import { renameConversation } from '@lib/services/dify/conversation-service';
import type { RenameConversationResponse } from '@lib/services/dify/types/conversations';
import type { PendingConversation } from '@lib/stores/pending-conversation-store';
import { usePendingConversationStore } from '@lib/stores/pending-conversation-store';

import { selectConversationIfCurrent } from './routing';
import type { OnConversationDbIdCreated } from './types';

type PendingConversationStatus = PendingConversation['status'];

const DEFAULT_PLACEHOLDER_TITLE_CANDIDATES = [
  '创建中...',
  'Creating...',
  '无标题',
  'Untitled',
];

export function resolveGeneratedTitle(
  renameResponse: Pick<RenameConversationResponse, 'name'> | null | undefined,
  untitledTitle: string
): string {
  const generatedTitle = renameResponse?.name?.trim();
  return generatedTitle || untitledTitle;
}

export function buildPlaceholderTitleCandidates(
  tempTitle: string,
  untitledTitle: string
): string[] {
  return Array.from(
    new Set(
      [tempTitle, untitledTitle, ...DEFAULT_PLACEHOLDER_TITLE_CANDIDATES]
        .map(title => title.trim())
        .filter(Boolean)
    )
  );
}

export async function persistResolvedConversationTitle(
  dbId: string | null | undefined,
  title: string,
  tempTitle: string
): Promise<boolean> {
  if (!dbId || title === tempTitle) {
    return false;
  }

  try {
    const result = await updateConversation(dbId, { title });
    if (result.success && result.data) {
      console.log(
        `[useCreateConversation] Database title update successful: ${title}`
      );
      conversationEvents.emit();
      return true;
    }

    console.error(
      '[useCreateConversation] Database title update rejected:',
      result.success ? result.data : result.error
    );
    return false;
  } catch (updateError) {
    console.error(
      '[useCreateConversation] Update database title failed:',
      updateError
    );
    return false;
  }
}

interface SaveConversationRecordInput {
  difyConvId: string;
  title: string;
  tempConvId: string;
  currentUserId?: string;
  appId: string;
  saveFailedTitle: string;
  updateStatusInPendingStore: (
    id: string,
    status: PendingConversationStatus
  ) => void;
  updateTitleInPendingStore: (
    id: string,
    title: string,
    isFinal: boolean
  ) => void;
  addToFavorites: (appId: string) => void | Promise<void>;
  onDbIdCreated?: OnConversationDbIdCreated;
}

export async function saveConversationRecord(
  input: SaveConversationRecordInput
): Promise<string | null> {
  if (!input.currentUserId || !input.appId) {
    console.error(
      '[useCreateConversation] Cannot save to DB: userId or appId is missing.',
      {
        currentUserId: input.currentUserId,
        appId: input.appId,
      }
    );
    input.updateStatusInPendingStore(input.tempConvId, 'failed');
    input.updateTitleInPendingStore(
      input.tempConvId,
      input.saveFailedTitle,
      true
    );
    return null;
  }

  try {
    console.log(
      `[useCreateConversation] Immediately create database records: difyId=${input.difyConvId}, title=${input.title}, userId=${input.currentUserId}, appId=${input.appId}`
    );

    const result = await createConversation({
      user_id: input.currentUserId,
      app_id: input.appId,
      external_id: input.difyConvId,
      title: input.title,
      ai_config_id: null,
      summary: null,
      settings: {},
      status: 'active',
      last_message_preview: null,
      metadata: {},
    });

    if (result.success && result.data) {
      const localConversation = result.data;
      console.log(
        `[useCreateConversation] Database records created successfully, database ID: ${localConversation.id}, Dify conversation ID: ${input.difyConvId}`
      );

      console.log(
        `[useCreateConversation] Add application to favorite list: ${input.appId}`
      );
      void input.addToFavorites(input.appId);

      const { markAsPersistedComplete } =
        usePendingConversationStore.getState();
      markAsPersistedComplete(input.difyConvId, localConversation.id);

      if (typeof input.onDbIdCreated === 'function') {
        console.log(
          `[useCreateConversation] Immediately notify that the database ID has been created: difyId=${input.difyConvId}, dbId=${localConversation.id}`
        );
        input.onDbIdCreated(input.difyConvId, localConversation.id);
      }

      conversationEvents.emit();
      return localConversation.id;
    }

    console.error(
      '[useCreateConversation] Conversation creation failed:',
      result.error
    );
    throw new Error(
      result.error?.message ||
        'Failed to save conversation to local DB or local ID not returned.'
    );
  } catch (dbError) {
    console.error(
      `[useCreateConversation] Error saving conversation (difyId: ${input.difyConvId}) to DB:`,
      dbError
    );
    input.updateStatusInPendingStore(input.tempConvId, 'failed');
    input.updateTitleInPendingStore(
      input.tempConvId,
      input.saveFailedTitle,
      true
    );
    return null;
  }
}

interface StartConversationTitleResolutionInput {
  appId: string;
  difyConvId: string;
  userIdentifier: string;
  tempConvId: string;
  tempTitle: string;
  untitledTitle: string;
  dbId?: string | null;
  startTitleTypewriter: (id: string, title: string) => void;
}

interface RecoverConversationTitleAfterStreamInput {
  appId: string;
  difyConvId: string;
  userIdentifier: string;
  dbId?: string | null;
  tempTitle: string;
  untitledTitle: string;
}

export async function recoverConversationTitleAfterStream(
  input: RecoverConversationTitleAfterStreamInput
): Promise<boolean> {
  if (!input.dbId) {
    return false;
  }

  try {
    const renameResponse = await renameConversation(
      input.appId,
      input.difyConvId,
      {
        user: input.userIdentifier,
        auto_generate: true,
      }
    );
    const finalTitle = resolveGeneratedTitle(
      renameResponse,
      input.untitledTitle
    );
    const placeholderTitles = buildPlaceholderTitleCandidates(
      input.tempTitle,
      input.untitledTitle
    );
    const result = await syncGeneratedTitleIfPlaceholder(
      input.dbId,
      input.userIdentifier,
      finalTitle,
      placeholderTitles
    );

    if (result.success && result.data) {
      console.log(
        `[useCreateConversation] Recovered generated title after stream: ${finalTitle}`
      );
      conversationEvents.emit();
      return true;
    }

    console.log(
      '[useCreateConversation] Post-stream title recovery skipped:',
      result.success ? result.data : result.error
    );
    return false;
  } catch (error) {
    console.error(
      '[useCreateConversation] Post-stream title recovery failed:',
      error
    );
    return false;
  }
}

export function startConversationTitleResolution(
  input: StartConversationTitleResolutionInput
): void {
  void renameConversation(input.appId, input.difyConvId, {
    user: input.userIdentifier,
    auto_generate: true,
  })
    .then(async renameResponse => {
      const finalTitle = resolveGeneratedTitle(
        renameResponse,
        input.untitledTitle
      );
      console.log(
        `[useCreateConversation] Title acquisition successful, start typewriter effect: ${finalTitle}`
      );

      input.startTitleTypewriter(input.tempConvId, finalTitle);

      await persistResolvedConversationTitle(
        input.dbId,
        finalTitle,
        input.tempTitle
      );

      selectConversationIfCurrent(
        input.difyConvId,
        'Error selecting item in sidebar after title'
      );
    })
    .catch(async renameError => {
      console.error(
        '[useCreateConversation] Title acquisition failed, use default title:',
        renameError
      );
      const fallbackTitle = input.untitledTitle;

      input.startTitleTypewriter(input.tempConvId, fallbackTitle);

      await persistResolvedConversationTitle(
        input.dbId,
        fallbackTitle,
        input.tempTitle
      );

      selectConversationIfCurrent(
        input.difyConvId,
        'Error selecting item in sidebar (title fetch failed)'
      );
    });
}
