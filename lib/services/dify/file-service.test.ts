/** @jest-environment node */
import { previewDifyFile } from './file-service';

describe('Dify file preview service', () => {
  afterEach(() => jest.restoreAllMocks());

  it.each([false, true])(
    'reads from demo without following redirects (download: %s)',
    async asAttachment => {
      const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response('original bytes', {
          headers: { 'Content-Type': 'image/png' },
        })
      );
      const result = await previewDifyFile('app-1', 'upload-1', {
        as_attachment: asAttachment,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/dify/app-1/files/upload-1/preview' +
          (asAttachment ? '?as_attachment=true' : ''),
        {
          method: 'GET',
          cache: 'no-store',
          credentials: 'same-origin',
          redirect: 'error',
        }
      );
      expect(await result.content.text()).toBe('original bytes');
      expect(result.headers.contentType).toBe('image/png');
    }
  );

  it('preserves a controlled unavailable file error', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          app_error: {
            code: 'DIFY_FILE_PREVIEW_EXPIRED',
            userMessage: 'Upload the original again.',
          },
        }),
        { status: 410 }
      )
    );
    await expect(previewDifyFile('app-1', 'upload-1')).rejects.toMatchObject({
      status: 410,
      code: 'DIFY_FILE_PREVIEW_EXPIRED',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
