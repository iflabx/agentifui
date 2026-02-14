/** @jest-environment node */
import { upsertUserIdentity } from '@lib/db/user-identities';
import { cacheService } from '@lib/services/db/cache-service';
import { dataService } from '@lib/services/db/data-service';

jest.mock('@lib/services/db/data-service', () => ({
  dataService: {
    findMany: jest.fn(),
    rawQuery: jest.fn(),
  },
}));

jest.mock('@lib/services/db/cache-service', () => ({
  cacheService: {
    deletePattern: jest.fn(),
  },
}));

describe('upsertUserIdentity', () => {
  const mockedFindMany = dataService.findMany as jest.MockedFunction<
    typeof dataService.findMany
  >;
  const mockedRawQuery = dataService.rawQuery as jest.MockedFunction<
    typeof dataService.rawQuery
  >;
  const mockedDeletePattern = cacheService.deletePattern as jest.MockedFunction<
    typeof cacheService.deletePattern
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedFindMany.mockResolvedValue({
      success: true,
      data: [],
    });
    mockedRawQuery.mockResolvedValue({
      success: true,
      data: [
        {
          id: 'identity-id',
          user_id: '00000000-0000-4000-8000-000000000001',
          issuer: 'urn:agentifui:better-auth',
          provider: 'better-auth',
          subject: 'legacy-user-id',
          email: 'test@example.com',
          email_verified: true,
          given_name: 'Test',
          family_name: 'User',
          preferred_username: 'test-user',
          raw_claims: {},
          created_at: '2026-02-14T00:00:00.000Z',
          updated_at: '2026-02-14T00:00:00.000Z',
          last_login_at: '2026-02-14T00:00:00.000Z',
        },
      ],
    });
  });

  it('rejects binding a second identity for the same user uuid', async () => {
    mockedFindMany.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'existing-identity-id',
          user_id: '00000000-0000-4000-8000-000000000001',
          issuer: 'https://idp-a.example.com',
          provider: 'oidc-a',
          subject: 'subject-a',
          email: 'test@example.com',
          email_verified: true,
          given_name: 'Test',
          family_name: 'User',
          preferred_username: 'test-user',
          raw_claims: {},
          created_at: '2026-02-14T00:00:00.000Z',
          updated_at: '2026-02-14T00:00:00.000Z',
          last_login_at: '2026-02-14T00:00:00.000Z',
        },
      ],
    });

    const result = await upsertUserIdentity({
      user_id: '00000000-0000-4000-8000-000000000001',
      issuer: 'https://idp-b.example.com',
      provider: 'oidc-b',
      subject: 'subject-b',
    });

    expect(result.success).toBe(false);
    expect(mockedRawQuery).not.toHaveBeenCalled();
  });

  it('allows upsert when the same identity is already bound to the user', async () => {
    mockedFindMany.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'existing-identity-id',
          user_id: '00000000-0000-4000-8000-000000000001',
          issuer: 'https://idp.example.com',
          provider: 'oidc',
          subject: 'subject-a',
          email: 'test@example.com',
          email_verified: true,
          given_name: 'Test',
          family_name: 'User',
          preferred_username: 'test-user',
          raw_claims: {},
          created_at: '2026-02-14T00:00:00.000Z',
          updated_at: '2026-02-14T00:00:00.000Z',
          last_login_at: '2026-02-14T00:00:00.000Z',
        },
      ],
    });

    const result = await upsertUserIdentity({
      user_id: '00000000-0000-4000-8000-000000000001',
      issuer: 'https://idp.example.com',
      provider: 'oidc',
      subject: 'subject-a',
    });

    expect(result.success).toBe(true);
    expect(mockedRawQuery).toHaveBeenCalledTimes(1);
    expect(mockedDeletePattern).toHaveBeenCalledWith('user_identities:*');
  });

  it('rejects switching to a different external provider on same identity', async () => {
    mockedFindMany.mockResolvedValueOnce({
      success: true,
      data: [
        {
          id: 'existing-identity-id',
          user_id: '00000000-0000-4000-8000-000000000001',
          issuer: 'urn:agentifui:better-auth',
          provider: 'github',
          subject: '00000000-0000-4000-8000-000000000001',
          email: 'test@example.com',
          email_verified: true,
          given_name: 'Test',
          family_name: 'User',
          preferred_username: 'test-user',
          raw_claims: {},
          created_at: '2026-02-14T00:00:00.000Z',
          updated_at: '2026-02-14T00:00:00.000Z',
          last_login_at: '2026-02-14T00:00:00.000Z',
        },
      ],
    });

    const result = await upsertUserIdentity({
      user_id: '00000000-0000-4000-8000-000000000001',
      issuer: 'urn:agentifui:better-auth',
      provider: 'gitlab',
      subject: '00000000-0000-4000-8000-000000000001',
    });

    expect(result.success).toBe(false);
    expect(mockedRawQuery).not.toHaveBeenCalled();
  });
});
