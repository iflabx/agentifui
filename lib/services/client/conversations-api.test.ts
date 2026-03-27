import type { Conversation } from '@lib/types/database';

jest.mock('@lib/db/internal-data-api', () => ({
  callInternalDataAction: jest.fn(),
}));

function createConversationRecord(
  overrides: Partial<Conversation> = {}
): Conversation {
  return {
    id: 'db-conv-1',
    user_id: 'user-1',
    ai_config_id: null,
    title: 'Creating...',
    summary: null,
    settings: {},
    created_at: '2026-03-26T00:00:00.000Z',
    updated_at: '2026-03-26T00:00:00.000Z',
    status: 'active',
    external_id: 'dify-conv-1',
    app_id: 'app-1',
    last_message_preview: null,
    metadata: {},
    ...overrides,
  };
}

describe('conversations-api lookup dedupe', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  it('dedupes concurrent external-id lookups and reuses the cached result', async () => {
    const { callInternalDataAction } = await import(
      '@lib/db/internal-data-api'
    );
    const mockedCallInternalDataAction =
      callInternalDataAction as jest.MockedFunction<
        typeof callInternalDataAction
      >;

    mockedCallInternalDataAction.mockReset();

    let resolveRequest:
      | ((value: { success: true; data: Conversation | null }) => void)
      | undefined;

    mockedCallInternalDataAction.mockImplementation(
      () =>
        new Promise(resolve => {
          resolveRequest = resolve as (value: {
            success: true;
            data: Conversation | null;
          }) => void;
        })
    );

    const { getConversationByExternalId } = await import('./conversations-api');

    const firstLookup = getConversationByExternalId('dify-conv-1');
    const secondLookup = getConversationByExternalId('dify-conv-1');

    expect(mockedCallInternalDataAction).toHaveBeenCalledTimes(1);

    resolveRequest?.({
      success: true,
      data: createConversationRecord(),
    });

    await expect(firstLookup).resolves.toMatchObject({
      success: true,
      data: expect.objectContaining({
        id: 'db-conv-1',
        external_id: 'dify-conv-1',
      }),
    });
    await expect(secondLookup).resolves.toMatchObject({
      success: true,
      data: expect.objectContaining({
        id: 'db-conv-1',
      }),
    });

    const cachedLookup = await getConversationByExternalId('dify-conv-1');
    expect(cachedLookup).toMatchObject({
      success: true,
      data: expect.objectContaining({
        id: 'db-conv-1',
      }),
    });
    expect(mockedCallInternalDataAction).toHaveBeenCalledTimes(1);
  });

  it('primes the external-id lookup cache after createConversation succeeds', async () => {
    const { callInternalDataAction } = await import(
      '@lib/db/internal-data-api'
    );
    const mockedCallInternalDataAction =
      callInternalDataAction as jest.MockedFunction<
        typeof callInternalDataAction
      >;

    mockedCallInternalDataAction.mockReset();

    mockedCallInternalDataAction.mockResolvedValueOnce({
      success: true,
      data: createConversationRecord(),
    });

    const { createConversation, getConversationByExternalId } = await import(
      './conversations-api'
    );

    const createResult = await createConversation({
      user_id: 'user-1',
      ai_config_id: null,
      title: 'Creating...',
      summary: null,
      settings: {},
      status: 'active',
      external_id: 'dify-conv-1',
      app_id: 'app-1',
      last_message_preview: null,
      metadata: {},
    });

    expect(createResult).toMatchObject({
      success: true,
      data: expect.objectContaining({
        id: 'db-conv-1',
      }),
    });
    expect(mockedCallInternalDataAction).toHaveBeenCalledTimes(1);

    const lookupResult = await getConversationByExternalId('dify-conv-1');
    expect(lookupResult).toMatchObject({
      success: true,
      data: expect.objectContaining({
        id: 'db-conv-1',
      }),
    });
    expect(mockedCallInternalDataAction).toHaveBeenCalledTimes(1);
  });
});
