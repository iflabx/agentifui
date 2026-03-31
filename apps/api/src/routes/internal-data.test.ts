/** @jest-environment node */
import Fastify from 'fastify';

import type { ApiRuntimeConfig } from '../config';
import { REQUEST_ID_HEADER } from '../lib/app-error';
import { internalDataRoutes } from './internal-data';
import { handleApiKeyAction } from './internal-data-route/api-key-actions';
import { handleAppExecutionAction } from './internal-data-route/app-execution-actions';
import { ensureActionPermission } from './internal-data-route/auth';
import { handleConversationAction } from './internal-data-route/conversation-actions';
import { handleErrorObservabilityAction } from './internal-data-route/error-observability-actions';
import { handleGroupAdminAction } from './internal-data-route/group-admin-actions';
import { handleGroupAuthAction } from './internal-data-route/group-auth-actions';
import { handleMessageAction } from './internal-data-route/message-actions';
import { handleProviderAction } from './internal-data-route/provider-actions';
import { handleServiceInstanceAction } from './internal-data-route/service-instance-actions';
import { handleSsoAction } from './internal-data-route/sso-actions';
import { handleUserAction } from './internal-data-route/user-actions';

jest.mock('./internal-data-route/auth', () => ({
  ensureActionPermission: jest.fn(),
}));

jest.mock('./internal-data-route/conversation-actions', () => ({
  handleConversationAction: jest.fn(),
}));

jest.mock('./internal-data-route/message-actions', () => ({
  handleMessageAction: jest.fn(),
}));

jest.mock('./internal-data-route/app-execution-actions', () => ({
  handleAppExecutionAction: jest.fn(),
}));

jest.mock('./internal-data-route/group-auth-actions', () => ({
  handleGroupAuthAction: jest.fn(),
}));

jest.mock('./internal-data-route/user-actions', () => ({
  handleUserAction: jest.fn(),
}));

jest.mock('./internal-data-route/group-admin-actions', () => ({
  handleGroupAdminAction: jest.fn(),
}));

jest.mock('./internal-data-route/provider-actions', () => ({
  handleProviderAction: jest.fn(),
}));

jest.mock('./internal-data-route/service-instance-actions', () => ({
  handleServiceInstanceAction: jest.fn(),
}));

jest.mock('./internal-data-route/api-key-actions', () => ({
  handleApiKeyAction: jest.fn(),
}));

jest.mock('./internal-data-route/sso-actions', () => ({
  handleSsoAction: jest.fn(),
}));

jest.mock('./internal-data-route/error-observability-actions', () => ({
  handleErrorObservabilityAction: jest.fn(),
}));

function createConfig(
  overrides: Partial<ApiRuntimeConfig> = {}
): ApiRuntimeConfig {
  return {
    host: '127.0.0.1',
    port: 3010,
    logLevel: 'silent',
    nextUpstreamBaseUrl: 'http://127.0.0.1:3000',
    proxyPrefixes: ['/api/internal/data'],
    realtimeSourceMode: 'db-outbox',
    sessionCookieNames: ['session_token'],
    internalDataProxyTimeoutMs: 30000,
    difyTempConfigEnabled: false,
    difyTempConfigAllowedHosts: [],
    difyTempConfigAllowPrivate: false,
    inputModeration: {
      enabled: false,
      app: null,
    },
    ...overrides,
  };
}

async function createApp(configOverrides: Partial<ApiRuntimeConfig> = {}) {
  const app = Fastify({ logger: false });
  await app.register(internalDataRoutes, {
    config: createConfig(configOverrides),
  });
  return app;
}

describe('internal data route shell', () => {
  const mockedEnsureActionPermission =
    ensureActionPermission as jest.MockedFunction<
      typeof ensureActionPermission
    >;
  const mockedHandleConversationAction =
    handleConversationAction as jest.MockedFunction<
      typeof handleConversationAction
    >;
  const mockedHandleMessageAction = handleMessageAction as jest.MockedFunction<
    typeof handleMessageAction
  >;
  const mockedHandleAppExecutionAction =
    handleAppExecutionAction as jest.MockedFunction<
      typeof handleAppExecutionAction
    >;
  const mockedHandleGroupAuthAction =
    handleGroupAuthAction as jest.MockedFunction<typeof handleGroupAuthAction>;
  const mockedHandleUserAction = handleUserAction as jest.MockedFunction<
    typeof handleUserAction
  >;
  const mockedHandleGroupAdminAction =
    handleGroupAdminAction as jest.MockedFunction<
      typeof handleGroupAdminAction
    >;
  const mockedHandleProviderAction =
    handleProviderAction as jest.MockedFunction<typeof handleProviderAction>;
  const mockedHandleServiceInstanceAction =
    handleServiceInstanceAction as jest.MockedFunction<
      typeof handleServiceInstanceAction
    >;
  const mockedHandleApiKeyAction = handleApiKeyAction as jest.MockedFunction<
    typeof handleApiKeyAction
  >;
  const mockedHandleSsoAction = handleSsoAction as jest.MockedFunction<
    typeof handleSsoAction
  >;
  const mockedHandleErrorObservabilityAction =
    handleErrorObservabilityAction as jest.MockedFunction<
      typeof handleErrorObservabilityAction
    >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedEnsureActionPermission.mockResolvedValue({
      error: null,
      actorUserId: '00000000-0000-4000-8000-000000000001',
    });
    mockedHandleConversationAction.mockResolvedValue(null);
    mockedHandleMessageAction.mockResolvedValue(null);
    mockedHandleAppExecutionAction.mockResolvedValue(null);
    mockedHandleGroupAuthAction.mockResolvedValue(null);
    mockedHandleUserAction.mockResolvedValue(null);
    mockedHandleGroupAdminAction.mockResolvedValue(null);
    mockedHandleProviderAction.mockResolvedValue(null);
    mockedHandleServiceInstanceAction.mockResolvedValue(null);
    mockedHandleApiKeyAction.mockResolvedValue(null);
    mockedHandleSsoAction.mockResolvedValue(null);
    mockedHandleErrorObservabilityAction.mockResolvedValue(null);
  });

  it('returns 400 when action is missing', async () => {
    const app = await createApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/data',
        headers: {
          'content-type': 'application/json',
          'x-request-id': 'req-missing-action',
        },
        payload: {},
      });

      expect(response.statusCode).toBe(400);
      expect(response.headers[REQUEST_ID_HEADER]).toBeTruthy();
      expect(response.json()).toMatchObject({
        error: 'Missing action',
      });
      expect(mockedEnsureActionPermission).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns permission error envelope without dispatching handlers', async () => {
    mockedEnsureActionPermission.mockResolvedValueOnce({
      error: {
        statusCode: 403,
        payload: { error: 'Forbidden' },
        contentType: 'application/json',
        handler: 'local',
      },
      actorUserId: '00000000-0000-4000-8000-000000000001',
    });

    const app = await createApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/data',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          action: 'users.getUserList',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({
        error: 'Forbidden',
      });
      expect(mockedHandleConversationAction).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('dispatches to the first matching domain handler', async () => {
    mockedHandleConversationAction.mockResolvedValueOnce({
      statusCode: 200,
      payload: {
        success: true,
        data: {
          conversations: [],
          total: 0,
        },
      },
      contentType: 'application/json',
      handler: 'local',
    });

    const app = await createApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/data',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          action: 'conversations.getUserConversations',
          payload: {
            userId: '00000000-0000-4000-8000-000000000001',
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        success: true,
        data: {
          conversations: [],
          total: 0,
        },
      });
      expect(mockedHandleConversationAction).toHaveBeenCalledTimes(1);
      expect(mockedHandleMessageAction).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('returns unsupported action when no domain handler accepts it', async () => {
    const app = await createApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/internal/data',
        headers: {
          'content-type': 'application/json',
        },
        payload: {
          action: 'unknown.action',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: 'Unsupported action: unknown.action',
      });
      expect(mockedHandleConversationAction).toHaveBeenCalled();
      expect(mockedHandleErrorObservabilityAction).toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});
