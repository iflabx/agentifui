/** @jest-environment node */
import {
  adjustApiPathByAppType,
  bindDifyRequestUser,
  buildScopedUpstreamQuery,
  isDifyFilePreviewPath,
  isValidDifyPath,
  normalizeRequestBody,
} from './helpers';

describe('workflow API path mapping', () => {
  it.each([
    'info',
    'parameters',
    'meta',
    'site',
    'files/upload',
    'files/file-1/preview',
    'audio-to-text',
    'text-to-audio',
    'workflows/run',
    'workflows/logs',
    'workflows/run/run-1',
    'workflows/tasks/task-1/stop',
    'workflows/version-1/run',
  ])('preserves the canonical endpoint %s', path => {
    expect(adjustApiPathByAppType(path.split('/'), 'workflow')).toBe(path);
  });

  it.each([
    ['run', 'workflows/run'],
    ['logs', 'workflows/logs'],
    ['run/run-1', 'workflows/run/run-1'],
    ['tasks/task-1/stop', 'workflows/tasks/task-1/stop'],
    ['version-1/run', 'workflows/version-1/run'],
  ])('maps only the explicit workflow alias %s', (path, expected) => {
    expect(adjustApiPathByAppType(path.split('/'), 'workflow')).toBe(expected);
  });

  it.each([
    'information',
    'parameters-extra',
    'meta/extra',
    'site/extra',
    'files/upload-extra',
    'files/file-1/preview/extra',
    'audio-to-text-extra',
    'text-to-audio-extra',
    'workflows/run/run-1/extra',
    'workflows/unknown',
    'workflow/run-1/events',
    'form/human_input/token',
  ])('rejects unsupported workflow paths without exposing %s', path => {
    const adjustedPath = adjustApiPathByAppType(path.split('/'), 'workflow');
    expect(isValidDifyPath(adjustedPath.split('/'))).toBe(false);
  });

  it.each([
    'files/../preview',
    'files//preview',
    'files/file-1/preview?user=victim',
    'run/run-1#ignored',
    'tasks/task-1%2Fother/stop',
  ])('keeps bad workflow paths invalid: %s', path => {
    const adjustedPath = adjustApiPathByAppType(path.split('/'), 'workflow');
    expect(isValidDifyPath(adjustedPath.split('/'))).toBe(false);
  });

  it('leaves other app routing unchanged', () => {
    expect(
      adjustApiPathByAppType(['files', 'file-1', 'preview'], 'chatbot')
    ).toBe('files/file-1/preview');
    expect(adjustApiPathByAppType(['chat-messages'], 'text-generation')).toBe(
      'completion-messages'
    );
    expect(adjustApiPathByAppType(['unknown'], undefined)).toBe('unknown');
  });
});

describe('file preview path matching', () => {
  it('matches only a valid canonical file preview path', () => {
    expect(isDifyFilePreviewPath('files/file-1/preview')).toBe(true);
  });

  it.each([
    'files/upload',
    'files/file-1/preview/extra',
    'workflows/files/file-1/preview',
    'files/../preview',
    'files//preview',
    'files/file-1/preview?ignored=1',
  ])('does not treat %s as a preview', path => {
    expect(isDifyFilePreviewPath(path)).toBe(false);
  });
});

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
