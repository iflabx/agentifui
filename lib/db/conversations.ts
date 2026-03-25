/**
 * Database query functions related to conversations.
 * Uses unified data service and Result wrappers.
 */
export {
  getConversationByExternalId,
  getConversationByExternalIdForUser,
  getConversationById,
  getConversationMessages,
  getUserConversations,
} from './conversations/read-operations';
export {
  deleteConversationForUser,
  permanentlyDeleteConversation,
  renameConversationForUser,
} from './conversations/ownership-operations';
export {
  addMessageToConversation,
  createConversation,
  createConversationForUser,
  createEmptyConversation,
  deleteConversation,
  renameConversation,
  updateConversation,
  updateConversationMetadata,
  updateMessageStatus,
} from './conversations/write-operations';
