import type { MutableRefObject } from 'react';

import type { ChatResolvedAppConfig } from './app-config';

export interface ChatSubmissionOwner {
  appConfig: ChatResolvedAppConfig;
  isCurrent: () => boolean;
  onStopped: () => void;
}

export const chatSubmissionOwners = new WeakMap<
  MutableRefObject<boolean>,
  ChatSubmissionOwner
>();
