/** @jest-environment node */
import { PHASE4_RESULT_PROFILE } from './agent-result';
import { diagnoseApp } from './app-diagnostics';

const config = {
  backend: 'dify' as const,
  baseUrl: 'https://upstream.example.test/v1',
  apiKey: 'synthetic-diagnostic-key',
};
const originalFetch = global.fetch;
const fetchMock = jest.fn();

beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
});
afterEach(() => {
  global.fetch = originalFetch;
  jest.useRealTimers();
});

it('only reads Dify parameters and never reflects private fields', async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        user_input_form: [{}],
        api_key: 'private',
        opening_statement: 'private',
      })
    )
  );
  expect(await diagnoseApp(config)).toEqual({
    status: 'success',
    code: 'connected',
    capabilities: ['inputForm'],
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://upstream.example.test/v1/parameters',
    expect.objectContaining({ method: 'GET', redirect: 'error' })
  );
});

it.each([
  [401, 'authenticationFailed'],
  [403, 'authenticationFailed'],
  [404, 'unsupported'],
  [405, 'unsupported'],
  [500, 'unavailable'],
])('maps HTTP %s to a safe %s result', async (status, code) => {
  fetchMock.mockResolvedValue(
    new Response('private upstream error', { status: Number(status) })
  );
  expect(await diagnoseApp(config)).toEqual({
    status: code === 'unsupported' ? 'unsupported' : 'error',
    code,
    capabilities: [],
  });
});

it.each([
  'not-json',
  '{}',
  '[]',
  JSON.stringify({ user_input_form: [], oversized: 'x'.repeat(256 * 1024) }),
])('rejects malformed or oversized responses', async body => {
  fetchMock.mockResolvedValue(new Response(body));
  expect((await diagnoseApp(config)).code).toBe('incompatible');
});

it('times out the entire read without returning raw errors', async () => {
  jest.useFakeTimers();
  fetchMock.mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () =>
          reject(new Error('private host'))
        );
      })
  );
  const result = diagnoseApp(config);
  await jest.advanceTimersByTimeAsync(15001);
  expect(await result).toEqual({
    status: 'error',
    code: 'timeout',
    capabilities: [],
  });
});

const agentConfig = {
  ...config,
  backend: 'langchain' as const,
  assistantId: 'chosen',
};
function advertised(results = false) {
  return new Response(
    JSON.stringify({
      assistant_id: 'default',
      agents: [
        {
          assistant_id: 'chosen',
          ag_ui_path: results ? '/ag-ui/deep' : '/ag-ui',
          ...(results
            ? {
                result_profile: PHASE4_RESULT_PROFILE,
                result_formats: ['text/markdown', 'text/csv'],
              }
            : {}),
        },
      ],
    })
  );
}

it('checks selected LangChain assistant without creating a thread or run', async () => {
  fetchMock.mockResolvedValue(advertised());
  expect(await diagnoseApp(agentConfig)).toEqual({
    status: 'success',
    code: 'connected',
    capabilities: ['text'],
  });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock).toHaveBeenCalledWith(
    'https://upstream.example.test/v1/capabilities',
    expect.objectContaining({ method: 'GET' })
  );
});

it('does not present paused tasks as an unsupported upstream', async () => {
  fetchMock.mockResolvedValue(advertised());
  expect(
    await diagnoseApp({ ...agentConfig, resultProfileEnabled: false })
  ).toMatchObject({ status: 'success', resultsPaused: true });
});

it('fails a result profile missing its upstream contract', async () => {
  fetchMock.mockResolvedValue(advertised());
  expect(
    (await diagnoseApp({ ...agentConfig, resultProfileEnabled: true })).code
  ).toBe('resultsUnavailable');
});

it('only advertises results with a compatible enabled contract', async () => {
  fetchMock.mockImplementation(() => Promise.resolve(advertised(true)));
  expect(
    await diagnoseApp({ ...agentConfig, resultProfileEnabled: true })
  ).toEqual({
    status: 'success',
    code: 'connected',
    capabilities: ['text', 'results'],
  });
  expect((await diagnoseApp(agentConfig)).code).toBe(
    'resultConfigurationMismatch'
  );
  expect(
    await diagnoseApp({ ...agentConfig, resultProfileEnabled: false })
  ).toMatchObject({
    status: 'success',
    capabilities: ['text'],
    resultsPaused: true,
  });
});

it('does not claim human confirmation from a generic capabilities reply', async () => {
  fetchMock.mockResolvedValue(advertised());
  expect((await diagnoseApp({ ...agentConfig, humanInput: true })).code).toBe(
    'incompatible'
  );
});

it('checks the native human confirmation contract with GET only', async () => {
  fetchMock.mockResolvedValue(
    new Response(
      JSON.stringify({
        agents: [
          {
            assistant_id: 'chosen',
            features: ['native_interrupt', 'native_resume'],
            one_task_per_thread: true,
            actions: ['approve', 'reject'],
          },
        ],
      })
    )
  );
  expect(
    await diagnoseApp({
      ...agentConfig,
      humanInput: true,
      resultProfileEnabled: true,
    })
  ).toEqual({
    status: 'success',
    code: 'connected',
    capabilities: ['humanInput'],
  });
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining('/capabilities'),
    expect.objectContaining({ method: 'GET' })
  );
});
