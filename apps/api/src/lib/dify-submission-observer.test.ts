/** @jest-environment node */
import {
  confirmSubmission,
  rejectUnacceptedSubmission,
} from './agent-submissions';
import { observeDifyResponse } from './dify-submission-observer';

jest.mock('./agent-submissions', () => ({
  confirmSubmission: jest.fn().mockResolvedValue(undefined),
  rejectUnacceptedSubmission: jest.fn().mockResolvedValue(undefined),
}));

function response(events: unknown[]) {
  return new Response(
    events.map(event => `data: ${JSON.stringify(event)}\r\n\r\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } }
  );
}

describe('Dify native acceptance evidence without browser persistence changes', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['\n', '\r\n', '\r'])(
    'observes %j framing across byte chunks without changing forwarded bytes',
    async newline => {
      const text = [
        ': comment',
        'data: {"event":"message",',
        'data: "task_id":"task","answer":"中文"}',
        '',
        'data: {"event":"message_end","task_id":"task"}',
        '',
        'data: {"event":"message_end","task_id":"task"}',
        '',
        '',
      ].join(newline);
      const bytes = new TextEncoder().encode(text);
      const upstream = new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes)
              controller.enqueue(new Uint8Array([byte]));
            controller.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } }
      );
      const forwarded = new Uint8Array(
        await observeDifyResponse(
          upstream,
          'root',
          'chat-messages'
        ).arrayBuffer()
      );
      expect(forwarded).toEqual(bytes);
      expect(confirmSubmission).toHaveBeenNthCalledWith(1, 'root', 'accepted');
      expect(confirmSubmission).toHaveBeenNthCalledWith(2, 'root', 'finished');
      expect(confirmSubmission).toHaveBeenCalledTimes(2);
    }
  );

  it('preserves exact bytes, confirms once and closes only on a native terminal', async () => {
    const original = response([
      { event: 'message', task_id: 'task', answer: 'synthetic text' },
      { event: 'message_end', task_id: 'task' },
    ]);
    const expected = await original.clone().text();
    const observed = observeDifyResponse(original, 'root', 'chat-messages');
    expect(await observed.text()).toBe(expected);
    expect(confirmSubmission).toHaveBeenNthCalledWith(1, 'root', 'accepted');
    expect(confirmSubmission).toHaveBeenNthCalledWith(2, 'root', 'finished');
    expect(confirmSubmission).toHaveBeenCalledTimes(2);
  });

  it('does not treat message_end as Chatflow workflow completion', async () => {
    await observeDifyResponse(
      response([
        { event: 'workflow_started', workflow_run_id: 'workflow' },
        { event: 'message_end', task_id: 'task' },
      ]),
      'root',
      'chat-messages'
    ).text();
    expect(confirmSubmission).toHaveBeenLastCalledWith('root', 'unknown');
    expect(confirmSubmission).not.toHaveBeenCalledWith('root', 'finished');
  });

  it('does not release a pause, malformed stream or EOF as successful execution', async () => {
    await observeDifyResponse(
      response([
        { event: 'workflow_started', workflow_run_id: 'workflow' },
        { event: 'workflow_paused', workflow_run_id: 'workflow' },
      ]),
      'root',
      'workflows/run'
    ).text();
    expect(confirmSubmission).toHaveBeenLastCalledWith('root', 'unknown');
    expect(confirmSubmission).not.toHaveBeenCalledWith('root', 'finished');
  });

  it('accepts a native blocking result but not a bare 200', async () => {
    await observeDifyResponse(
      new Response(
        JSON.stringify({ message_id: 'message', answer: 'synthetic' })
      ),
      'root',
      'completion-messages'
    ).text();
    expect(confirmSubmission).toHaveBeenLastCalledWith('root', 'finished');
    jest.clearAllMocks();
    await observeDifyResponse(
      new Response('{}'),
      'root',
      'completion-messages'
    ).text();
    expect(confirmSubmission).toHaveBeenCalledTimes(1);
    expect(confirmSubmission).toHaveBeenCalledWith('root', 'unknown');
  });

  it('keeps response cancellation unknown instead of releasing reservations', async () => {
    const upstream = new Response(new ReadableStream({ pull() {} }), {
      headers: { 'content-type': 'text/event-stream' },
    });
    await observeDifyResponse(upstream, 'root', 'chat-messages').body!.cancel();
    expect(confirmSubmission).toHaveBeenCalledWith('root', 'unknown');
  });

  it('finishes an accepted native error rather than keeping a known failure active forever', async () => {
    await observeDifyResponse(
      response([
        { event: 'workflow_started', workflow_run_id: 'workflow' },
        { event: 'error', code: 'internal_error', status: 500 },
      ]),
      'root',
      'workflows/run'
    ).text();
    expect(confirmSubmission).toHaveBeenLastCalledWith('root', 'finished');
    expect(confirmSubmission).not.toHaveBeenCalledWith('root', 'unknown');
    expect(rejectUnacceptedSubmission).not.toHaveBeenCalled();
  });

  it('releases only an explicit native refusal and does not guess from bare blocking error fields', async () => {
    await observeDifyResponse(
      new Response(
        JSON.stringify({
          code: 'invalid_param',
          status: 400,
          message: 'synthetic refusal',
        })
      ),
      'root',
      'completion-messages'
    ).text();
    expect(rejectUnacceptedSubmission).toHaveBeenCalledWith('root');
    expect(confirmSubmission).not.toHaveBeenCalled();
    jest.clearAllMocks();
    await observeDifyResponse(
      new Response(
        JSON.stringify({ code: 'internal_error', error: 'ambiguous' })
      ),
      'root',
      'completion-messages'
    ).text();
    expect(rejectUnacceptedSubmission).not.toHaveBeenCalled();
    expect(confirmSubmission).toHaveBeenCalledWith('root', 'unknown');
  });

  it('does not treat node IDs as proof of task acceptance or paused blocking workflows as finished', async () => {
    await observeDifyResponse(
      response([{ event: 'node_started', data: { id: 'node' } }]),
      'root',
      'workflows/run'
    ).text();
    expect(confirmSubmission).not.toHaveBeenCalledWith('root', 'accepted');
    jest.clearAllMocks();
    await observeDifyResponse(
      new Response(
        JSON.stringify({
          workflow_run_id: 'run',
          data: { id: 'run', status: 'paused' },
        })
      ),
      'root',
      'workflows/run'
    ).text();
    expect(confirmSubmission).toHaveBeenLastCalledWith('root', 'unknown');
  });

  it('persists an edit identity before confirming acceptance and forwarding its completed frame', async () => {
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    const onIdentity = jest.fn(async () => {
      entered();
      await waiting;
    });
    const observed = observeDifyResponse(
      response([
        { event: 'message_end', message_id: 'native-message', task_id: 'task' },
      ]),
      'root',
      'chat-messages',
      onIdentity
    );
    const reader = observed.body!.getReader();
    let forwarded = false;
    const next = reader.read().then(value => {
      forwarded = true;
      return value;
    });
    await started;
    expect(confirmSubmission).not.toHaveBeenCalled();
    expect(forwarded).toBe(false);
    release();
    expect((await next).value).toBeDefined();
    expect(confirmSubmission).toHaveBeenNthCalledWith(1, 'root', 'accepted');
    expect(confirmSubmission).toHaveBeenNthCalledWith(2, 'root', 'finished');
    await reader.cancel();
  });

  it('does not forward the accepted frame when edit persistence fails', async () => {
    const failure = new Error('edit persistence failed');
    const onIdentity = jest.fn().mockRejectedValue(failure);
    await expect(
      observeDifyResponse(
        response([{ event: 'message', message_id: 'native-message' }]),
        'root',
        'chat-messages',
        onIdentity
      ).text()
    ).rejects.toBe(failure);
    expect(confirmSubmission).not.toHaveBeenCalledWith('root', 'accepted');
    expect(confirmSubmission).toHaveBeenCalledWith('root', 'unknown');
  });

  it('does not call edit persistence for a refusal or an ambiguous bare response', async () => {
    const onIdentity = jest.fn();
    await observeDifyResponse(
      new Response('{}'),
      'root',
      'chat-messages',
      onIdentity
    ).text();
    await observeDifyResponse(
      response([{ code: 'invalid_param', status: 400 }]),
      'root',
      'chat-messages',
      onIdentity
    ).text();
    expect(onIdentity).not.toHaveBeenCalled();
  });
});
