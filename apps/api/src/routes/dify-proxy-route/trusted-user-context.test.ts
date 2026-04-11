/** @jest-environment node */
import { queryRowsWithPgSystemContext } from '../../lib/pg-context';
import {
  buildTrustedUserInputs,
  injectTrustedUserContext,
  loadTrustedUserProfile,
  shouldInjectTrustedUserContext,
} from './trusted-user-context';
import type { DifyProxyActor } from './types';

jest.mock('../../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
}));

function createActor(overrides: Partial<DifyProxyActor> = {}): DifyProxyActor {
  return {
    userId: '00000000-0000-4000-8000-000000000123',
    role: 'user',
    ...overrides,
  };
}

describe('trusted-user-context helpers', () => {
  const mockedQueryRowsWithPgSystemContext =
    queryRowsWithPgSystemContext as jest.MockedFunction<
      typeof queryRowsWithPgSystemContext
    >;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('matches only supported POST text-like routes', () => {
    expect(shouldInjectTrustedUserContext('POST', 'chat-messages')).toBe(true);
    expect(shouldInjectTrustedUserContext('POST', 'completion-messages')).toBe(
      true
    );
    expect(shouldInjectTrustedUserContext('POST', 'workflows/run')).toBe(true);
    expect(shouldInjectTrustedUserContext('GET', 'chat-messages')).toBe(false);
    expect(shouldInjectTrustedUserContext('POST', 'files/upload')).toBe(false);
  });

  it('loads optional trusted user profile fields from the database', async () => {
    mockedQueryRowsWithPgSystemContext.mockResolvedValueOnce([
      {
        full_name: '  张三  ',
        username: ' zhangsan ',
        email: ' user@example.com ',
        employee_number: ' 20260001 ',
        department: ' 图书馆 ',
        job_title: ' 学生 ',
      } as never,
    ]);

    await expect(
      loadTrustedUserProfile('00000000-0000-4000-8000-000000000123')
    ).resolves.toEqual({
      fullName: '张三',
      username: 'zhangsan',
      email: 'user@example.com',
      employeeNumber: '20260001',
      department: '图书馆',
      jobTitle: '学生',
    });
  });

  it('builds the minimal trusted inputs when no profile is available', () => {
    expect(buildTrustedUserInputs(createActor(), null)).toEqual({
      agentifui_user_id: '00000000-0000-4000-8000-000000000123',
      agentifui_user_role: 'user',
    });
  });

  it('overwrites forged reserved fields while preserving business inputs', () => {
    expect(
      injectTrustedUserContext(
        {
          query: 'hello',
          inputs: {
            foo: 'bar',
            agentifui_user_role: 'admin',
            agentifui_user_department: '伪造部门',
          },
          user: 'forged-user-id',
        },
        createActor(),
        {
          fullName: '张三',
          username: 'zhangsan',
          email: 'user@example.com',
          employeeNumber: '20260001',
          department: '图书馆',
          jobTitle: '学生',
        }
      )
    ).toEqual({
      query: 'hello',
      inputs: {
        foo: 'bar',
        agentifui_user_id: '00000000-0000-4000-8000-000000000123',
        agentifui_user_role: 'user',
        agentifui_user_name: '张三',
        agentifui_user_username: 'zhangsan',
        agentifui_user_email: 'user@example.com',
        agentifui_user_employee_number: '20260001',
        agentifui_user_department: '图书馆',
        agentifui_user_job_title: '学生',
      },
      user: '00000000-0000-4000-8000-000000000123',
    });
  });

  it('creates inputs when missing and supports JSON string bodies', () => {
    expect(
      injectTrustedUserContext(
        JSON.stringify({
          query: 'hello',
          user: 'frontend-user',
        }),
        createActor(),
        null
      )
    ).toEqual({
      query: 'hello',
      inputs: {
        agentifui_user_id: '00000000-0000-4000-8000-000000000123',
        agentifui_user_role: 'user',
      },
      user: '00000000-0000-4000-8000-000000000123',
    });
  });

  it('returns the original payload for non-object request bodies', () => {
    expect(
      injectTrustedUserContext(Buffer.from('plain-text'), createActor(), null)
    ).toEqual(Buffer.from('plain-text'));
  });
});
