/** @jest-environment node */
import {
  canReadDifyUpload,
  hasDifyUploadReference,
} from './dify-upload-access';
import { queryRowsWithPgSystemContext } from './pg-context';

jest.mock('./pg-context', () => ({ queryRowsWithPgSystemContext: jest.fn() }));

const scope = { userId: 'actor', serviceInstanceId: 'app', fileId: 'file' };

beforeEach(() => jest.resetAllMocks());

it.each([canReadDifyUpload, hasDifyUploadReference])(
  'guards registry and archive references against deleted linked conversations',
  async check => {
    jest
      .mocked(queryRowsWithPgSystemContext)
      .mockResolvedValueOnce([{ allowed: false }]);
    expect(await check(scope, { conversationId: 'conversation' })).toBe(false);
    const [sql, params] = jest.mocked(queryRowsWithPgSystemContext).mock
      .calls[0];
    expect(sql).toContain("e.status<>'deleted'");
    expect(sql).toContain("execution_conversation.status='active'");
    expect(sql).toContain('execution_conversation.user_id=$1::uuid');
    expect(sql).toContain('execution_conversation.app_id=$2::text');
    expect(sql).toContain('e.conversation_id IS NULL');
    expect(sql).toContain('e.conversation_id=$4::uuid');
    expect(sql).toContain('NOT bound_once');
    expect(params).toEqual([
      'actor',
      'app',
      'file',
      'conversation',
      null,
      check === canReadDifyUpload,
    ]);
  }
);
