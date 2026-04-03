/** @jest-environment node */
import { buildScopedUpstreamQuery } from './helpers';

describe('buildScopedUpstreamQuery', () => {
  it('adds the actor user to file preview requests when missing', () => {
    expect(
      buildScopedUpstreamQuery({
        rawQuery: '',
        slugPath: 'files/file-1/preview',
        actorUserId: 'user-1',
      })
    ).toBe('?user=user-1');
  });

  it('preserves existing preview query parameters while injecting the actor user', () => {
    expect(
      buildScopedUpstreamQuery({
        rawQuery: '?as_attachment=true',
        slugPath: 'files/file-1/preview',
        actorUserId: 'user-1',
      })
    ).toBe('?as_attachment=true&user=user-1');
  });

  it('does not override an explicitly provided user query parameter', () => {
    expect(
      buildScopedUpstreamQuery({
        rawQuery: '?user=explicit-user',
        slugPath: 'files/file-1/preview',
        actorUserId: 'user-1',
      })
    ).toBe('?user=explicit-user');
  });

  it('leaves non-preview routes unchanged', () => {
    expect(
      buildScopedUpstreamQuery({
        rawQuery: '',
        slugPath: 'chat-messages',
        actorUserId: 'user-1',
      })
    ).toBe('');
  });
});
