/** @jest-environment node */
import { resolveDifyConfig } from './dify-config';
import { queryRowsWithPgSystemContext } from './pg-context';

jest.mock('./pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
  queryRowsWithPgUserContext: jest.fn(),
}));

describe('Dify backend isolation', () => {
  const originalKey = process.env.API_ENCRYPTION_KEY;
  beforeEach(() => {
    jest.resetAllMocks();
    process.env.API_ENCRYPTION_KEY = 'test-encryption-key';
  });
  afterAll(() => {
    if (originalKey === undefined) delete process.env.API_ENCRYPTION_KEY;
    else process.env.API_ENCRYPTION_KEY = originalKey;
  });

  it('rejects LangChain before fetching or decrypting service credentials', async () => {
    jest.mocked(queryRowsWithPgSystemContext).mockResolvedValueOnce([
      {
        id: 'instance',
        instance_id: 'agent',
        config: { backend_type: 'langchain' },
      },
    ]);
    expect(await resolveDifyConfig('agent')).toBeNull();
    expect(queryRowsWithPgSystemContext).toHaveBeenCalledTimes(1);
    expect(
      jest.mocked(queryRowsWithPgSystemContext).mock.calls[0][0]
    ).not.toContain('FROM api_keys');
  });

  it.each([undefined, 'dify'])(
    'preserves Dify configuration when backend_type is %s',
    async backendType => {
      jest
        .mocked(queryRowsWithPgSystemContext)
        .mockResolvedValueOnce([
          {
            id: 'instance',
            instance_id: 'chat',
            provider_base_url: 'https://backend.example/v1',
            config: { backend_type: backendType },
          },
        ])
        .mockResolvedValueOnce([{ key_value: 'test-dify-key' }]);
      expect(await resolveDifyConfig('chat')).toMatchObject({
        apiKey: 'test-dify-key',
        appId: 'chat',
      });
      expect(queryRowsWithPgSystemContext).toHaveBeenCalledTimes(2);
    }
  );
});
