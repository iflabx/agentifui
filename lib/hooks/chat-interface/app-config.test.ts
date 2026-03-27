import { resolveChatSubmitAppConfig } from './app-config';

const mockGetCurrentAppStoreState = jest.fn();
const mockLogCurrentAppDebugSnapshot = jest.fn();

jest.mock('@lib/stores/current-app-store', () => ({
  useCurrentAppStore: {
    getState: (...args: unknown[]) => mockGetCurrentAppStoreState(...args),
  },
}));

jest.mock('@lib/utils/current-app-debug', () => ({
  logCurrentAppDebugSnapshot: (...args: unknown[]) =>
    mockLogCurrentAppDebugSnapshot(...args),
}));

describe('resolveChatSubmitAppConfig', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentAppStoreState.mockReturnValue({
      currentAppId: 'default-app',
      currentAppInstance: {
        instance_id: 'default-app',
        display_name: 'Default App',
      },
    });
  });

  it('prefers the route app for new detail-page submissions', async () => {
    const validateConfig = jest.fn().mockResolvedValue(undefined);
    const ensureAppReady = jest.fn().mockResolvedValue({
      appId: 'target-app',
      instance: {
        instance_id: 'target-app',
        display_name: 'Target App',
      },
    });
    const onErrorMessage = jest.fn();

    const result = await resolveChatSubmitAppConfig({
      conversationAppId: null,
      preferredRouteAppId: 'target-app',
      ensureAppReady,
      validateConfig,
      onErrorMessage,
    });

    expect(validateConfig).toHaveBeenCalledWith('target-app', 'message');
    expect(ensureAppReady).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      appId: 'target-app',
      instance: {
        instance_id: 'target-app',
        display_name: 'Target App',
      },
    });
    expect(onErrorMessage).not.toHaveBeenCalled();
  });

  it('blocks submission when the resolved app does not match the route app', async () => {
    const validateConfig = jest.fn().mockResolvedValue(undefined);
    const ensureAppReady = jest.fn().mockResolvedValue({
      appId: 'default-app',
      instance: {
        instance_id: 'default-app',
        display_name: 'Default App',
      },
    });
    const onErrorMessage = jest.fn();

    const result = await resolveChatSubmitAppConfig({
      conversationAppId: null,
      preferredRouteAppId: 'target-app',
      ensureAppReady,
      validateConfig,
      onErrorMessage,
    });

    expect(result).toBeNull();
    expect(onErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Submission blocked')
    );
  });

  it('still prioritizes historical conversation app over route app', async () => {
    const validateConfig = jest.fn().mockResolvedValue(undefined);
    const ensureAppReady = jest.fn().mockResolvedValue({
      appId: 'history-app',
      instance: {
        instance_id: 'history-app',
        display_name: 'History App',
      },
    });
    const onErrorMessage = jest.fn();

    const result = await resolveChatSubmitAppConfig({
      conversationAppId: 'history-app',
      preferredRouteAppId: 'target-app',
      ensureAppReady,
      validateConfig,
      onErrorMessage,
    });

    expect(validateConfig).toHaveBeenCalledWith('history-app', 'message');
    expect(result).toEqual({
      appId: 'history-app',
      instance: {
        instance_id: 'history-app',
        display_name: 'History App',
      },
    });
    expect(onErrorMessage).not.toHaveBeenCalled();
  });
});
