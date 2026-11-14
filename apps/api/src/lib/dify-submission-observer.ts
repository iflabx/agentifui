import {
  confirmSubmission,
  rejectUnacceptedSubmission,
} from './agent-submissions';

const NATIVE_REFUSAL_CODES = new Set([
  'invalid_param',
  'unauthorized',
  'forbidden',
  'not_found',
  'app_unavailable',
  'provider_not_initialize',
  'model_currently_not_support',
]);

export function observeDifyResponse(
  upstream: Response,
  taskId: string,
  path: string
): Response {
  if (!upstream.body) return upstream;
  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  const sse = /text\/event-stream/i.test(
    upstream.headers.get('content-type') ?? ''
  );
  let buffer = '';
  let dataLines: string[] = [];
  let frameSize = 0;
  let skipLineFeed = false;
  let accepted = false;
  let terminal = false;
  let workflow = path.startsWith('workflows/');
  const inspect = async (value: unknown) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const event = value as Record<string, unknown>;
    const data =
      event.data && typeof event.data === 'object'
        ? (event.data as Record<string, unknown>)
        : {};
    if (event.event === 'workflow_started') workflow = true;
    const hasIdentity = [
      event.task_id,
      event.message_id,
      event.workflow_run_id,
      event.event === 'workflow_started' ||
      event.event === 'workflow_finished' ||
      (!sse && workflow)
        ? data.id
        : undefined,
    ].some(identity => typeof identity === 'string' && identity.length > 0);
    if (
      !accepted &&
      !hasIdentity &&
      typeof event.code === 'string' &&
      NATIVE_REFUSAL_CODES.has(event.code) &&
      [400, 401, 403, 404, 413, 415, 422].includes(
        Number(event.status ?? upstream.status)
      )
    ) {
      await rejectUnacceptedSubmission(taskId);
      terminal = true;
      return;
    }
    if (!accepted && hasIdentity) {
      await confirmSubmission(taskId, 'accepted');
      accepted = true;
    }
    const finished =
      event.event === 'workflow_finished' ||
      event.event === 'error' ||
      (!workflow && event.event === 'message_end') ||
      (!sse &&
        hasIdentity &&
        !event.event &&
        (!workflow ||
          ['succeeded', 'failed', 'stopped', 'partial-succeeded'].includes(
            String(data.status)
          )));
    if (accepted && !terminal && finished) {
      await confirmSubmission(taskId, 'finished');
      terminal = true;
    }
  };
  const inspectFrame = async () => {
    const payload = dataLines.join('\n');
    dataLines = [];
    frameSize = 0;
    if (!payload) return;
    try {
      await inspect(JSON.parse(payload));
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  };
  const processText = async (text: string) => {
    if (!sse) {
      buffer += text;
      if (buffer.length > 1024 * 1024)
        throw new Error('AGENT_UPSTREAM_EVENT_TOO_LARGE');
      return;
    }
    for (const character of text) {
      if (skipLineFeed) {
        skipLineFeed = false;
        if (character === '\n') continue;
      }
      if (character === '\r' || character === '\n') {
        if (!buffer) await inspectFrame();
        else if (buffer.startsWith('data:')) {
          const value = buffer.slice(5);
          dataLines.push(value.startsWith(' ') ? value.slice(1) : value);
        }
        buffer = '';
        skipLineFeed = character === '\r';
      } else {
        buffer += character;
        frameSize += 1;
        if (frameSize > 1024 * 1024)
          throw new Error('AGENT_UPSTREAM_EVENT_TOO_LARGE');
      }
    }
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          await processText(decoder.decode());
          if (sse) {
            if (buffer.startsWith('data:')) dataLines.push(buffer.slice(5));
            await inspectFrame();
          }
          if (!sse && buffer) {
            try {
              await inspect(JSON.parse(buffer));
            } catch (error) {
              if (!(error instanceof SyntaxError)) throw error;
            }
          }
          if (!terminal) await confirmSubmission(taskId, 'unknown');
          controller.close();
          reader.releaseLock();
          return;
        }
        await processText(decoder.decode(chunk.value, { stream: true }));
        controller.enqueue(chunk.value);
      } catch (error) {
        await confirmSubmission(taskId, 'unknown').catch(() => undefined);
        await reader.cancel().catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel(reason) {
      await confirmSubmission(taskId, 'unknown').catch(() => undefined);
      await reader.cancel(reason);
    },
  });
  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: upstream.headers,
  });
}
