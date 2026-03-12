import type {
  CreateConversationPayload,
  OnCreateConversationNodeEvent,
  UseCreateConversationReturn,
} from '@lib/hooks/create-conversation/types';
import { streamDifyChat } from '@lib/services/dify/chat-service';
import type { DifyChatRequestPayload } from '@lib/services/dify/types';
import type { ChatMessage } from '@lib/stores/chat-store';
import { useChatStore } from '@lib/stores/chat-store';

import {
  persistUserMessageIfNeeded,
  resolveDbConversationUuidByExternalId,
} from './conversation-db';
import type { ChatStreamCompletionData, DifyLocalFile } from './types';

export interface ChatSubmitStartResult {
  answerStream?: AsyncGenerator<string, void, undefined>;
  finalRealConvId?: string;
  finalTaskId?: string;
  finalDbConvUUID: string | null;
  completionPromise?: Promise<ChatStreamCompletionData>;
}

interface PrepareChatSubmitConversationStateInput {
  urlIndicatesNew: boolean;
  difyConversationId: string | null;
  setDifyConversationId: (conversationId: string | null) => void;
  setCurrentConversationId: (conversationId: string | null) => void;
}

export function prepareChatSubmitConversationState(
  input: PrepareChatSubmitConversationStateInput
): boolean {
  const isNewConversationFlow =
    input.urlIndicatesNew || !input.difyConversationId;

  if (!isNewConversationFlow) {
    return false;
  }

  if (input.difyConversationId !== null) {
    input.setDifyConversationId(null);
  }

  const currentConversationId = useChatStore.getState().currentConversationId;
  if (input.urlIndicatesNew && currentConversationId !== null) {
    input.setCurrentConversationId(null);
  }

  return true;
}

interface StartNewChatConversationInput {
  payload: CreateConversationPayload;
  appId: string;
  currentUserId: string;
  userMessage: ChatMessage;
  currentPathname: string | null;
  initiateNewConversation: UseCreateConversationReturn['initiateNewConversation'];
  setDbConversationUUID: (conversationId: string) => void;
  setCurrentConversationId: (conversationId: string | null) => void;
  setCurrentTaskId: (taskId: string | null) => void;
  navigateToConversation: (conversationId: string) => void;
  saveMessage: (
    message: ChatMessage,
    conversationId: string,
    retryCount?: number
  ) => Promise<boolean>;
  onNodeEvent?: OnCreateConversationNodeEvent;
}

export async function startNewChatConversation(
  input: StartNewChatConversationInput
): Promise<ChatSubmitStartResult> {
  let finalDbConvUUID: string | null = null;

  const creationResult = await input.initiateNewConversation(
    input.payload,
    input.appId,
    input.currentUserId,
    (_difyId, dbId) => {
      console.log(
        `[handleSubmit] Received db conversation ID callback: dbId=${dbId}`
      );
      finalDbConvUUID = dbId;
      input.setDbConversationUUID(dbId);

      persistUserMessageIfNeeded({
        userMessage: input.userMessage,
        conversationId: dbId,
        saveMessage: input.saveMessage,
        successLog: '[handleSubmit] User message saved in callback, ID=',
        errorLog: '[handleSubmit] Failed to save user message in callback:',
      });

      console.log(
        '[handleSubmit] DB ID callback done, user message saved, assistant message will be saved after streaming'
      );
    },
    input.onNodeEvent
  );

  if (creationResult.error) {
    console.error(
      '[handleSubmit] Failed to create new conversation:',
      creationResult.error
    );
    throw creationResult.error;
  }

  const finalRealConvId = creationResult.realConvId;
  const finalTaskId = creationResult.taskId;

  if (finalRealConvId) {
    if (useChatStore.getState().currentConversationId !== finalRealConvId) {
      input.setCurrentConversationId(finalRealConvId);
    }
    if (input.currentPathname !== `/chat/${finalRealConvId}`) {
      input.navigateToConversation(finalRealConvId);
    }

    finalDbConvUUID = await resolveDbConversationUuidByExternalId({
      externalId: finalRealConvId,
      setDbConversationUUID: input.setDbConversationUUID,
      errorLog: '[handleSubmit] Failed to query db ID for new conversation:',
      missingLog: `[handleSubmit] No db record found for new conversation, Dify conversation ID=${finalRealConvId}`,
    });
  }

  if (finalTaskId) {
    input.setCurrentTaskId(finalTaskId);
  }

  return {
    answerStream: creationResult.answerStream,
    finalRealConvId,
    finalTaskId,
    finalDbConvUUID,
    completionPromise: creationResult.completionPromise,
  };
}

interface StartExistingChatConversationInput {
  message: string;
  inputs?: Record<string, unknown>;
  difyFiles?: DifyLocalFile[];
  appId: string;
  currentUserId: string;
  difyConversationId: string;
  dbConversationUUID: string | null;
  userMessage: ChatMessage;
  currentPathname: string | null;
  saveMessage: (
    message: ChatMessage,
    conversationId: string,
    retryCount?: number
  ) => Promise<boolean>;
  setDifyConversationId: (conversationId: string | null) => void;
  setCurrentConversationId: (conversationId: string | null) => void;
  setDbConversationUUID: (conversationId: string) => void;
  setCurrentTaskId: (taskId: string | null) => void;
  navigateToConversation: (conversationId: string) => void;
  onNodeEvent?: OnCreateConversationNodeEvent;
}

export async function startExistingChatConversation(
  input: StartExistingChatConversationInput
): Promise<ChatSubmitStartResult> {
  let finalDbConvUUID = input.dbConversationUUID;

  if (!finalDbConvUUID) {
    finalDbConvUUID = await resolveDbConversationUuidByExternalId({
      externalId: input.difyConversationId,
      setDbConversationUUID: input.setDbConversationUUID,
      errorLog:
        '[handleSubmit] Failed to query db ID for existing conversation:',
      missingLog: `[handleSubmit] No db record found for existing conversation, Dify conversation ID=${input.difyConversationId}`,
    });
  }

  persistUserMessageIfNeeded({
    userMessage: input.userMessage,
    conversationId: finalDbConvUUID,
    saveMessage: input.saveMessage,
    successLog:
      '[handleSubmit] User message saved early in historical conversation, ID=',
    errorLog:
      '[handleSubmit] Failed to save user message early in historical conversation:',
  });

  console.log('[handleSubmit] Conversation ID type check:', {
    type: typeof input.difyConversationId,
    length: input.difyConversationId.length,
    hasWhitespace: /\s/.test(input.difyConversationId),
    value: input.difyConversationId,
  });

  const difyPayload: DifyChatRequestPayload = {
    query: input.message,
    inputs: input.inputs || {},
    ...(input.difyFiles && { files: input.difyFiles }),
    user: input.currentUserId,
    response_mode: 'streaming',
    conversation_id: input.difyConversationId,
    auto_generate_name: false,
  };

  const streamServiceResponse = await streamDifyChat(
    difyPayload,
    input.appId,
    newlyFetchedConvId => {
      if (
        newlyFetchedConvId &&
        input.difyConversationId !== newlyFetchedConvId
      ) {
        input.setDifyConversationId(newlyFetchedConvId);
        input.setCurrentConversationId(newlyFetchedConvId);

        if (input.currentPathname !== `/chat/${newlyFetchedConvId}`) {
          input.navigateToConversation(newlyFetchedConvId);
        }

        if (!finalDbConvUUID) {
          void resolveDbConversationUuidByExternalId({
            externalId: newlyFetchedConvId,
            setDbConversationUUID: input.setDbConversationUUID,
            successLog: '[handleSubmit] Found db conversation ID: ',
            errorLog:
              '[handleSubmit] Failed to query db conversation ID in callback:',
            missingLog: `[handleSubmit] No db record found, Dify conversation ID=${newlyFetchedConvId}`,
          }).then(dbConversationId => {
            finalDbConvUUID = dbConversationId;
          });
        }
      }
    },
    input.onNodeEvent
  );

  const finalRealConvId =
    streamServiceResponse.getConversationId() ||
    input.difyConversationId ||
    undefined;
  const finalTaskId = streamServiceResponse.getTaskId() || undefined;
  const completionPromise = streamServiceResponse.completionPromise;

  if (finalRealConvId && finalRealConvId !== input.difyConversationId) {
    input.setDifyConversationId(finalRealConvId);

    if (!finalDbConvUUID && finalRealConvId !== input.difyConversationId) {
      finalDbConvUUID = await resolveDbConversationUuidByExternalId({
        externalId: finalRealConvId,
        setDbConversationUUID: input.setDbConversationUUID,
        successLog: '[handleSubmit] Found db conversation ID: ',
        errorLog: '[handleSubmit] Failed to query db conversation ID:',
        missingLog: `[handleSubmit] No db record found, Dify conversation ID=${finalRealConvId}`,
      });
    }
  }

  if (finalTaskId) {
    input.setCurrentTaskId(finalTaskId);
  }

  console.log('[handleSubmit] Existing conversation handled, state:', {
    finalRealConvId,
    finalDbConvUUID,
    storeConversationId: useChatStore.getState().currentConversationId,
    urlPath: window.location.pathname,
  });

  return {
    answerStream: streamServiceResponse.answerStream,
    finalRealConvId,
    finalTaskId,
    finalDbConvUUID,
    completionPromise,
  };
}
