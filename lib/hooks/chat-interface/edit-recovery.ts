import { AppRequestError } from '@lib/errors/app-error';
import { dbMessageToChatMessage } from '@lib/hooks/use-conversation-messages/helpers';
import { agentSubmissionRequest } from '@lib/services/client/langchain-api';
import { getMessagePage } from '@lib/services/client/messages-api';
import { useChatStore } from '@lib/stores/chat-store';
import type { EditSubmissionResult } from '@lib/types/message-edit';

export function isDefiniteEditRejection(error: unknown): boolean {
  return (
    error instanceof AppRequestError &&
    ([400, 401, 403, 404, 405, 413, 415, 422].includes(error.status) ||
      [
        'INVALID_MESSAGE_EDIT',
        'MESSAGE_EDIT_SOURCE_UNAVAILABLE',
        'MESSAGE_EDIT_CONVERSATION_UNAVAILABLE',
        'MESSAGE_EDIT_IDENTITY_CONFLICT',
        'CONTENT_MODERATION_BLOCKED',
        'CONTENT_MODERATION_UNAVAILABLE',
        'AGENT_CONCURRENCY_LIMIT',
        'AGENT_QUOTA_EXCEEDED',
        'AGENT_REGISTRATION_LIMIT',
      ].includes(error.detail?.code ?? ''))
  );
}

export function pendingDifyEdit(input: {
  appId: string;
  submissionId: string;
  conversationId: string;
  sourceId: string;
  messageId: string;
  isCurrent: () => boolean;
}): Exclude<EditSubmissionResult, boolean> {
  return {
    status: 'unknown',
    submissionId: input.submissionId,
    check: async () => {
      if (!input.isCurrent()) return null;
      const submission = await agentSubmissionRequest(
        input.appId,
        input.submissionId
      );
      if (!input.isCurrent()) return null;
      if (submission.state === 'rejected') {
        useChatStore.setState(state => ({
          messages: state.messages.filter(
            message => message.id !== input.messageId
          ),
        }));
        return false;
      }
      if (!['accepted', 'finished', 'unknown'].includes(submission.state))
        return null;
      const page = await getMessagePage(input.conversationId, { limit: 100 });
      if (!input.isCurrent() || !page.success || !page.data) return null;
      if (
        !page.data.messages.some(
          message =>
            message.metadata?.client_message_id === input.messageId &&
            message.metadata?.edit_source_id === input.sourceId &&
            message.metadata?.edit_pending !== true
        )
      )
        return null;
      const state = useChatStore.getState();
      const source = state.messages.findIndex(
        message =>
          message.id === input.sourceId || message.db_id === input.sourceId
      );
      const recovered = page.data.messages.map(dbMessageToChatMessage);
      if (source < 0) return true;
      const ids = new Set(recovered.map(message => message.db_id));
      useChatStore.setState({
        messages: [
          ...state.messages
            .slice(0, Math.max(0, source))
            .filter(message => !ids.has(message.db_id)),
          ...recovered,
        ],
      });
      return true;
    },
  };
}
