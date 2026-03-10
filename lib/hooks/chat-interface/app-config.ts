import type { ServiceInstance } from '@lib/types/database';

import { formatChatUiError } from './error-utils';

export interface ChatResolvedAppConfig {
  appId: string;
  instance: ServiceInstance;
}

interface ResolveChatSubmitAppConfigInput {
  conversationAppId: string | null;
  ensureAppReady: () => Promise<ChatResolvedAppConfig>;
  validateConfig: (
    appId?: string,
    context?: 'message' | 'switch' | 'general'
  ) => Promise<void>;
  onErrorMessage: (errorMessage: string) => void;
}

export async function resolveChatSubmitAppConfig(
  input: ResolveChatSubmitAppConfigInput
): Promise<ChatResolvedAppConfig | null> {
  try {
    console.log('[handleSubmit] Start determining app to use...');

    if (input.conversationAppId) {
      console.log(
        `[handleSubmit] Historical conversation, using original appId: ${input.conversationAppId}`
      );
      await input.validateConfig(input.conversationAppId, 'message');
      const appConfig = await input.ensureAppReady();

      if (appConfig.appId !== input.conversationAppId) {
        console.warn(
          `[handleSubmit] Failed to switch to original app, expected: ${input.conversationAppId}, actual: ${appConfig.appId}`
        );
      }

      console.log(`[handleSubmit] Final app used: ${appConfig.appId}`);
      return appConfig;
    }

    console.log(
      '[handleSubmit] New conversation or no original appId, using current selected app'
    );
    const appConfig = await input.ensureAppReady();
    console.log(`[handleSubmit] Final app used: ${appConfig.appId}`);
    return appConfig;
  } catch (error) {
    console.error('[handleSubmit] Failed to get app config:', error);
    const { errorMessage } = formatChatUiError(
      error,
      'Failed to get app config',
      'frontend'
    );
    input.onErrorMessage(errorMessage);
    return null;
  }
}

interface ResolveChatStopAppConfigInput {
  currentAppId: string | null | undefined;
  currentAppInstance: ServiceInstance | null | undefined;
}

export function resolveChatStopAppConfig(
  input: ResolveChatStopAppConfigInput
): ChatResolvedAppConfig | null {
  if (input.currentAppId && input.currentAppInstance) {
    const appConfig = {
      appId: input.currentAppId,
      instance: input.currentAppInstance,
    };
    console.log(
      `[handleStopProcessing] Using current app config: ${appConfig.appId}`
    );
    return appConfig;
  }

  console.warn(
    '[handleStopProcessing] Current app config unavailable, only perform local stop'
  );
  return null;
}
