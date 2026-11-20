import { reportClientError } from '../../lib/services/client/error-reporting';

test('browser beacon omits page query, hash and business context', async () => {
  window.history.replaceState(
    {},
    '',
    '/reset-password/synthetic-reset-secret?token=synthetic-query-secret#synthetic-hash-secret'
  );
  const beacon = jest.fn().mockReturnValue(true);
  Object.defineProperty(navigator, 'sendBeacon', {
    configurable: true,
    value: beacon,
  });
  await expect(
    reportClientError({
      code: 'CLIENT_SAVE_FAILED',
      userMessage: 'HTTP 503',
      requestId: 'safe-correlation',
      context: {
        prompt: 'synthetic-prompt-secret',
        href: window.location.href,
        lineno: 7,
      },
    })
  ).resolves.toBe(true);
  const body = beacon.mock.calls[0][1] as Blob;
  const text = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(body);
  });
  for (const secret of [
    'synthetic-reset-secret',
    'synthetic-query-secret',
    'synthetic-hash-secret',
    'synthetic-prompt-secret',
  ])
    expect(text).not.toContain(secret);
  expect(JSON.parse(text)).toMatchObject({
    route: '/reset-password/[redacted]',
    requestId: 'safe-correlation',
    context: { lineno: 7 },
  });
  window.history.replaceState({}, '', '/');
});
