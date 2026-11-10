/** @jest-environment node */
import {
  bindDifyRequestUser,
  buildScopedUpstreamQuery,
  isValidDifyPath,
  normalizeRequestBody,
} from './helpers';

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

  it('overrides an explicitly provided user query parameter', () => {
    expect(
      buildScopedUpstreamQuery({
        rawQuery: '?user=explicit-user',
        slugPath: 'files/file-1/preview',
        actorUserId: 'user-1',
      })
    ).toBe('?user=user-1');
  });

  it('binds non-preview routes to the same actor', () => {
    expect(
      buildScopedUpstreamQuery({
        rawQuery: '',
        slugPath: 'chat-messages',
        actorUserId: 'user-1',
      })
    ).toBe('?user=user-1');
  });

  it('removes duplicate user selectors while preserving pagination', () => {
    expect(
      buildScopedUpstreamQuery({
        rawQuery: '?user=victim&limit=10&user=other',
        slugPath: 'conversations',
        actorUserId: 'actor',
      })
    ).toBe('?user=actor&limit=10');
  });
});

describe('Dify user and path boundaries', () => {
  it.each([
    'conversations',
    'messages',
    'files/file-1/preview',
    'chat-messages',
  ])('allows a normal path: %s', path =>
    expect(isValidDifyPath(path.split('/'))).toBe(true)
  );

  it.each([
    'chat-messages?ignored=1',
    'chat-messages#ignored',
    'chat-messages%3Fignored',
    '../chat-messages',
    'files//preview',
    'chat-messages\\other',
    'chat-messages ',
  ])('rejects ambiguous upstream path: %s', path => {
    expect(isValidDifyPath(path.split('/'))).toBe(false);
  });

  it('binds JSON mutation identity without losing operation fields', async () => {
    await expect(
      bindDifyRequestUser(
        { user: 'victim', name: 'new title' },
        'application/json',
        'actor'
      )
    ).resolves.toEqual({ user: 'actor', name: 'new title' });
  });

  it('binds JSON strings but rejects plain-text JSON', async () => {
    await expect(
      bindDifyRequestUser('{"user":"victim"}', 'Application/JSON', 'actor')
    ).resolves.toEqual({ user: 'actor' });
    await expect(
      bindDifyRequestUser('{"user":"victim"}', 'text/plain', 'actor')
    ).rejects.toThrow('Unsupported request body type');
  });

  it('replaces multipart identity and preserves file bytes', async () => {
    const form = new FormData();
    form.append('user', 'victim');
    form.append('user', 'other');
    form.append(
      'file',
      new Blob(['file-content'], { type: 'text/plain' }),
      'file.txt'
    );
    const request = new Request('https://upstream.example.com', {
      method: 'POST',
      body: form,
    });
    const result = await bindDifyRequestUser(
      Buffer.from(await request.arrayBuffer()),
      request.headers.get('content-type')!,
      'actor'
    );
    expect(result).toBeInstanceOf(FormData);
    const rebound = result as FormData;
    expect(rebound.getAll('user')).toEqual(['actor']);
    expect(await (rebound.get('file') as File).text()).toBe('file-content');
    expect((rebound.get('file') as File).name).toBe('file.txt');
  });
});

test('normalizes a sliced Buffer without including surrounding bytes', async () => {
  const original = Buffer.from([10, 20, 30, 40]);
  const body = normalizeRequestBody(original.subarray(1, 3));
  original.fill(0);
  expect(
    Array.from(new Uint8Array(await new Response(body).arrayBuffer()))
  ).toEqual([20, 30]);
});

test('normalizes a shared byte view into a fetch-compatible body', async () => {
  const original = new Uint8Array(new SharedArrayBuffer(4));
  original.set([10, 20, 30, 40]);
  const body = normalizeRequestBody(original.subarray(1, 3));
  expect(
    Array.from(new Uint8Array(await new Response(body).arrayBuffer()))
  ).toEqual([20, 30]);
});

test('keeps JSON and absent request body semantics', () => {
  expect(normalizeRequestBody({ message: 'hello' })).toBe(
    '{"message":"hello"}'
  );
  expect(normalizeRequestBody(null)).toBeNull();
});
