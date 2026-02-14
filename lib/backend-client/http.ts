export async function fetchJson<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const headers = new Headers(init.headers || {});
  const body = init.body;

  if (body && !(body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(path, {
    ...init,
    headers,
    credentials: 'include',
  });

  const payload = (await response.json().catch(() => null)) as
    | (T & { error?: string })
    | null;

  if (!response.ok) {
    const errorMessage =
      (payload && typeof payload === 'object' && 'error' in payload
        ? payload.error
        : null) || `Request failed (${response.status})`;
    throw new Error(errorMessage);
  }

  if (payload === null) {
    throw new Error(`Invalid JSON payload from ${path}`);
  }

  return payload;
}
