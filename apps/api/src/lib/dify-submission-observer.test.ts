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
});
