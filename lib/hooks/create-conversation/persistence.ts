'use client';

import { conversationEvents } from '@lib/hooks/use-combined-conversations';
import {
  createConversation,
  updateConversation,
} from '@lib/services/client/conversations-api';
import { renameConversation } from '@lib/services/dify/conversation-service';
import type { PendingConversation } from '@lib/stores/pending-conversation-store';
import { usePendingConversationStore } from '@lib/stores/pending-conversation-store';

import { selectConversationIfCurrent } from './routing';
import type { OnConversationDbIdCreated } from './types';

type PendingConversationStatus = PendingConversation['status'];

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

export function startConversationTitleResolution(
  input: StartConversationTitleResolutionInput
): void {
  void renameConversation(input.appId, input.difyConvId, {
    user: input.userIdentifier,
    auto_generate: true,
  })
    .then(async renameResponse => {
      const finalTitle =
        renameResponse && renameResponse.name
          ? renameResponse.name
          : input.untitledTitle;
      console.log(
        `[useCreateConversation] Title acquisition successful, start typewriter effect: ${finalTitle}`
      );

      input.startTitleTypewriter(input.tempConvId, finalTitle);

      if (input.dbId && finalTitle !== input.tempTitle) {
        try {
          await updateConversation(input.dbId, { title: finalTitle });
          console.log(
            `[useCreateConversation] Database title update successful: ${finalTitle}`
          );
          conversationEvents.emit();
        } catch (updateError) {
          console.error(
            '[useCreateConversation] Update database title failed:',
            updateError
          );
        }
      }

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

      if (input.dbId) {
        try {
          await updateConversation(input.dbId, {
            title: fallbackTitle,
          });
          console.log(
            `[useCreateConversation] Update database with default title: ${fallbackTitle}`
          );
          conversationEvents.emit();
        } catch (updateError) {
          console.error(
            '[useCreateConversation] Update default title failed:',
            updateError
          );
        }
      }

      selectConversationIfCurrent(
        input.difyConvId,
        'Error selecting item in sidebar (title fetch failed)'
      );
    });
}
