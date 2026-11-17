/** @jest-environment node */
import { previewDifyFile } from './file-service';

describe('Dify file preview service', () => {
  afterEach(() => jest.restoreAllMocks());

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
});
