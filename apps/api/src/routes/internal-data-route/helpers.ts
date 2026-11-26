import { sanitizeExecution as sanitizeExecutionRow } from './helpers/sanitizers';
import type { AppExecutionRow } from './types';

export {
  enrichResponsePayload,
  sendActionResponse,
  toErrorResponse,
  toFailureResponse,
  toSuccessResponse,
} from './helpers/response';
export {
  escapeLikePattern,
  normalizeNullableTextValue,
  normalizePayload,
  normalizeRequestBody,
  parseAccountStatus,
  parseAppVisibility,
  parseExecutionStatus,
  parseExecutionType,
  parseMessageRole,
  parseMessageStatus,
  parsePositiveInt,
  parseSsoProtocol,
  parseUserRole,
  readBoolean,
  readObject,
  readString,
  readStringArray,
  resolvePayloadUserId,
} from './helpers/parse';
export {
  isIdpManagedAuthSource,
  normalizeAuthSource,
  resolveEditableProfileColumns,
  sanitizeApiKeyRow,
  sanitizeConversation,
  sanitizeGroupMemberRow,
  sanitizeGroupPermissionRow,
  sanitizeMessage,
  sanitizeProfileRow,
  sanitizeProviderRow,
  sanitizeServiceInstanceRow,
  sanitizeSsoProviderRow,
} from './helpers/sanitizers';
export { buildAssistantPreview, encryptApiKeyValue } from './helpers/security';

export function sanitizeExecution(row: AppExecutionRow): AppExecutionRow {
  return {
    ...sanitizeExecutionRow(row),
    conversation_id: row.conversation_id ?? null,
    submission_id: row.submission_id ?? null,
  };
}
