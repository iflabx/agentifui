/** @jest-environment node */
import {
  fetchWithDifyProxyResilience,
  getDifyProxyCircuitSnapshot,
  getDifyProxyResilienceMetricsSnapshot,
} from './dify-proxy-resilience';

describe('Dify response lifecycle', () => {
  let circuitKey: string;
  beforeEach(() => {
    jest.useFakeTimers();
    circuitKey = `lifecycle-${Math.random()}`;
    delete (globalThis as Record<string, unknown>)
      .__agentifui_fastify_dify_proxy_resilience_metrics__;
  });
  afterEach(() => {
    expect(jest.getTimerCount()).toBe(0);
    jest.useRealTimers();
  });

  async function open(
    contentType = 'application/json',
    downstream?: AbortController
  ) {
    let source!: ReadableStreamDefaultController<Uint8Array>;
    let signal!: AbortSignal;
    const cancel = jest.fn();
    const result = await fetchWithDifyProxyResilience({
      circuitKey,
      requestSignal: downstream?.signal,
      configOverride: { timeoutMs: 1000, failureThreshold: 1 },
      execute: async upstreamSignal => {
        signal = upstreamSignal;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              source = controller;
            },
            cancel,
          }),
          { headers: { 'Content-Type': contentType } }
        );
      },
    });
    if (!result.ok) throw new Error('Expected response headers');
    return { response: result.response, source, signal, cancel };
  }

  it('times out a stalled body after receiving JSON headers', async () => {
    const { response, signal, cancel } = await open();
    const pending = expect(response.text()).rejects.toMatchObject({
      reason: 'timeout',
    });
    expect(
      getDifyProxyResilienceMetricsSnapshot().upstreamSuccessStatusCount
    ).toBe(0);
    await jest.advanceTimersByTimeAsync(1001);
    await pending;
    expect(signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(getDifyProxyCircuitSnapshot(circuitKey).status).toBe('open');
  });

  it('keeps the total JSON deadline even when some body bytes arrive', async () => {
    const { response, source } = await open();
    const pending = expect(response.text()).rejects.toMatchObject({
      reason: 'timeout',
    });
    await jest.advanceTimersByTimeAsync(700);
    source.enqueue(new TextEncoder().encode('{'));
    await jest.advanceTimersByTimeAsync(400);
    await pending;
  });

  it('aborts a pending response body when the downstream disconnects', async () => {
    const downstream = new AbortController();
    const remove = jest.spyOn(downstream.signal, 'removeEventListener');
    const { response, signal, cancel } = await open(
      'application/json',
      downstream
    );
    const pending = expect(response.text()).rejects.toMatchObject({
      reason: 'client-abort',
    });
    downstream.abort();
    await pending;
    expect(signal.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(getDifyProxyCircuitSnapshot(circuitKey).failureCount).toBe(0);
  });

  it('permits an active SSE beyond the total timeout and then expires idle reads', async () => {
    const { response, source } = await open('text/event-stream');
    const reader = response.body!.getReader();
    for (let index = 0; index < 4; index += 1) {
      const pending = reader.read();
      await jest.advanceTimersByTimeAsync(700);
      source.enqueue(new TextEncoder().encode('data: ping\n\n'));
      expect((await pending).done).toBe(false);
    }
    const pending = expect(reader.read()).rejects.toMatchObject({
      reason: 'timeout',
    });
    await jest.advanceTimersByTimeAsync(1001);
    await pending;
  });

  it('releases the deadline after a complete response', async () => {
    const { response, source, signal } = await open();
    source.enqueue(new TextEncoder().encode('{}'));
    source.close();
    expect(await response.text()).toBe('{}');
    await jest.advanceTimersByTimeAsync(2000);
    expect(signal.aborted).toBe(false);
    expect(
      getDifyProxyResilienceMetricsSnapshot().upstreamSuccessStatusCount
    ).toBe(1);
  });

  it('cleans up consumer cancellation and upstream read failures', async () => {
    const cancelled = await open();
    await cancelled.response.body!.cancel();
    expect(cancelled.signal.aborted).toBe(true);
    const failed = await open();
    const pending = expect(failed.response.text()).rejects.toMatchObject({
      reason: 'network-error',
    });
    failed.source.error(new Error('Disconnected upstream'));
    await pending;
  });

  it('rejects a pre-aborted request without executing fetch', async () => {
    const downstream = new AbortController();
    downstream.abort();
    const execute = jest.fn();
    expect(
      await fetchWithDifyProxyResilience({
        circuitKey,
        execute,
        requestSignal: downstream.signal,
      })
    ).toMatchObject({ ok: false, reason: 'client-abort' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('times out headers and completes no-content responses without a body timer', async () => {
    const pending = fetchWithDifyProxyResilience({
      circuitKey,
      configOverride: { timeoutMs: 1000, circuitEnabled: false },
      execute: () => new Promise<Response>(() => undefined),
    });
    await jest.advanceTimersByTimeAsync(1001);
    expect(await pending).toMatchObject({ ok: false, reason: 'timeout' });
    const result = await fetchWithDifyProxyResilience({
      circuitKey,
      execute: async () => new Response(null, { status: 204 }),
    });
    expect(result.ok).toBe(true);
  });
});
