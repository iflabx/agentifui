/** @jest-environment node */
import { previewDifyFile } from './file-service';

describe('Dify file preview service', () => {
  afterEach(() => jest.restoreAllMocks());

  it('falls back after a signed URL network or CORS failure', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(
        new Response('retained original', {
          headers: { 'Content-Type': 'text/plain' },
        })
      );
    const result = await previewDifyFile('app-1', 'upload-1', {
      preview_url:
        'https://dify.example.com/files/upload-1/file-preview?sign=expired',
    });
    expect(await result.content.text()).toBe('retained original');
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/dify/app-1/files/upload-1/preview',
      { method: 'GET' }
    );
  });

  it('does not retry the same local preview endpoint on failure', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          code: 'DIFY_FILE_PREVIEW_EXPIRED',
          message: 'Upload the original again.',
        }),
        { status: 410 }
      )
    );
    await expect(
      previewDifyFile('app-1', 'upload-1', {
        preview_url: '/api/dify/app-1/files/upload-1/preview',
      })
    ).rejects.toMatchObject({ status: 410, code: 'DIFY_FILE_PREVIEW_EXPIRED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the signed upload URL for workflow files', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      headers: new Headers({
        'Content-Type': 'text/plain',
        'Content-Length': '5',
      }),
      blob: async () => new Blob(['hello'], { type: 'text/plain' }),
    } as Response);

    const result = await previewDifyFile('app-1', 'file-1', {
      preview_url:
        'https://dify.example.com/files/file-1/file-preview?timestamp=1&nonce=2&sign=3',
      as_attachment: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://dify.example.com/files/file-1/file-preview?timestamp=1&nonce=2&sign=3&as_attachment=true',
      { method: 'GET' }
    );
    expect(await result.content.text()).toBe('hello');
    expect(result.headers.contentType).toBe('text/plain');
  });

  it('falls back to the authenticated proxy when the signed URL expires', async () => {
    const fetchMock = jest
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 403 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        headers: new Headers({ 'Content-Type': 'text/plain' }),
        blob: async () => new Blob(['fallback'], { type: 'text/plain' }),
      } as Response);

    const result = await previewDifyFile('app-1', 'file-1', {
      preview_url:
        'https://dify.example.com/files/file-1/file-preview?sign=expired',
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/dify/app-1/files/file-1/preview',
      { method: 'GET' }
    );
    expect(await result.content.text()).toBe('fallback');
  });
});
