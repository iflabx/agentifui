import { useCurrentAppStore } from '@lib/stores/current-app-store';
import type { ServiceInstance } from '@lib/types/database';

import { formatChatUiError } from './error-utils';

export interface ChatResolvedAppConfig {
  appId: string;
  instance: ServiceInstance;
}

interface ResolveChatSubmitAppConfigInput {
  conversationAppId: string | null;
  preferredRouteAppId?: string | null;
  targetAppId?: string | null;
  ensureAppReady: (targetAppId?: string) => Promise<ChatResolvedAppConfig>;
  validateConfig: (
    appId?: string,
    context?: 'message' | 'switch' | 'general'
  ) => Promise<void>;
  onErrorMessage: (errorMessage: string) => void;
}

export async function resolveChatSubmitAppConfig(
  input: ResolveChatSubmitAppConfigInput
): Promise<ChatResolvedAppConfig | null> {
  const targetAppId =
    input.targetAppId ||
    input.conversationAppId ||
    input.preferredRouteAppId ||
    useCurrentAppStore.getState().currentAppId;
  try {
    if (!targetAppId) throw new Error('No target app. Submission blocked.');
    const appConfig = await input.ensureAppReady(targetAppId);
    if (
      appConfig.appId !== targetAppId ||
      appConfig.instance.instance_id !== targetAppId
    ) {
      throw new Error(
        `Submission blocked: expected app ${targetAppId}, got ${appConfig.appId}.`
      );
    }
    return appConfig;
  } catch (error) {
    const { errorMessage } = formatChatUiError(
      error,
      'Failed to get app config',
      'frontend'
    );
    input.onErrorMessage(errorMessage);
    return null;
  }
}

export function resolveChatStopAppConfig(input: {
  currentAppId: string | null | undefined;
  currentAppInstance: ServiceInstance | null | undefined;
}): ChatResolvedAppConfig | null {
  if (!input.currentAppId || !input.currentAppInstance) return null;
  return { appId: input.currentAppId, instance: input.currentAppInstance };
}
