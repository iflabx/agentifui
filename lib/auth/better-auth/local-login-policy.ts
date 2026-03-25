export type {
  AuthMode,
  LocalLoginAuditInput,
  LocalLoginDecision,
  LocalLoginDecisionReason,
  LocalLoginPolicyContext,
  UserLocalLoginState,
} from './local-login-policy/types';

export { evaluateLocalLoginByEmail } from './local-login-policy/evaluation';
export { recordLocalLoginAudit } from './local-login-policy/audit';
export {
  extractClientIp,
  parseSignInEmailFromRequest,
} from './local-login-policy/helpers';
export {
  getAuthModeSetting,
  getUserLocalLoginStateByUserId,
  hasCredentialPasswordByAuthUserId,
  markFallbackPasswordUpdated,
  setAuthModeSetting,
  setUserLocalLoginEnabledByUserId,
} from './local-login-policy/settings';
