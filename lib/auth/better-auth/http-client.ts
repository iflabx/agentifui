export type {
  AuthJsonResult,
  BetterAuthSession,
  BetterAuthUser,
} from './http-client/types';

export {
  requestPasswordReset,
  resetPasswordWithToken,
  sendPhoneOtp,
  signInWithEmailPassword,
  signInWithSocialProvider,
  signInWithSsoProvider,
  signOutCurrentSession,
  signUpWithEmail,
  verifyPhoneOtp,
} from './http-client/request';

export {
  getCurrentSession,
  getCurrentUser,
  subscribeAuthStateChange,
} from './http-client/session';
