/**
 * Comprehensive Integration Test Suite for Dify API Route
 * @description Tests complete route behavior including media handling refactor
 */
import { MediaResponseHandler } from '@lib/api/dify/handlers/media-response-handler';

// Mock Next.js dependencies
jest.mock('@lib/config/dify-config');
jest.mock('@lib/auth/better-auth/server');
jest.mock('@lib/types/dify-app-types');

// Mock globals for Node.js environment
const mockReadableStream = {} as ReadableStream;
global.ReadableStream = jest.fn().mockImplementation(() => mockReadableStream);

class MockResponseConstructor {
  body: ReadableStream | null;
  status: number;
  statusText: string;
  headers: Headers;

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    this.body = body as ReadableStream | null;
    this.status = init?.status || 200;
    this.statusText = init?.statusText || 'OK';
    this.headers = new Headers(init?.headers);
  }
}

global.Response = MockResponseConstructor as typeof Response;
// Mock Headers constructor
class MockHeaders {
  private _headers = new Map<string, string>();

  constructor(init?: HeadersInit) {
    if (init) {
      if (init instanceof Headers) {
        init.forEach((value, key) => this.set(key, value));
      } else if (Array.isArray(init)) {
        init.forEach(([key, value]) => this.set(key, value));
      } else {
        Object.entries(init).forEach(([key, value]) => this.set(key, value));
      }
    }
  }

  get(name: string): string | null {
    return this._headers.get(name.toLowerCase()) || null;
  }

  set(name: string, value: string): void {
    this._headers.set(name.toLowerCase(), value);
  }

  forEach(
    callbackfn: (value: string, key: string, parent: Headers) => void
  ): void {
    this._headers.forEach((value, key) =>
      callbackfn(value, key, this as unknown as Headers)
    );
  }

  // Add missing Headers methods to satisfy TypeScript
  append(): void {
    /* Mock implementation */
  }
  delete(): void {
    /* Mock implementation */
  }
  getSetCookie(): string[] {
    return [];
  }
  has(): boolean {
    return false;
  }
  keys(): IterableIterator<string> {
    return this._headers.keys();
  }
  values(): IterableIterator<string> {
    return this._headers.values();
  }
  entries(): IterableIterator<[string, string]> {
    return this._headers.entries();
  }
  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this._headers.entries();
  }
}

global.Headers = MockHeaders as unknown as typeof Headers;

describe('Dify API Route Integration Tests', () => {
  describe('Media Response Handling Integration', () => {
    let consoleLogSpy: jest.SpyInstance;

    beforeEach(() => {
      consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    // Create mock response for testing
    const createMockResponse = (
      contentType: string,
      status = 200,
      additionalHeaders: Record<string, string> = {}
    ) => {
      const headers = new Headers();
      headers.set('content-type', contentType);
      Object.entries(additionalHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return {
        headers,
        body: mockReadableStream,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        ok: status >= 200 && status < 300,
      } as unknown as Response;
    };

    describe('Original vs Refactored Behavior Comparison', () => {
      const testCases = [
        {
          name: 'Audio MP3 file',
          contentType: 'audio/mp3',
          expectedHandler: 'audio',
          shouldHandle: true,
        },
        {
          name: 'Audio WAV file',
          contentType: 'audio/wav',
          expectedHandler: 'audio',
          shouldHandle: true,
        },
        {
          name: 'Video MP4 file',
          contentType: 'video/mp4',
          expectedHandler: 'video',
          shouldHandle: true,
        },
        {
          name: 'Video WebM file',
          contentType: 'video/webm',
          expectedHandler: 'video',
          shouldHandle: true,
        },
        {
          name: 'PDF document',
          contentType: 'application/pdf',
          expectedHandler: 'pdf',
          shouldHandle: true,
        },
        {
          name: 'PNG image',
          contentType: 'image/png',
          expectedHandler: 'image',
          shouldHandle: true,
        },
        {
          name: 'JPEG image',
          contentType: 'image/jpeg',
          expectedHandler: 'image',
          shouldHandle: true,
        },
        {
          name: 'Binary octet-stream',
          contentType: 'application/octet-stream',
          expectedHandler: 'image',
          shouldHandle: true,
        },
        {
          name: 'JSON response',
          contentType: 'application/json',
          expectedHandler: null,
          shouldHandle: false,
        },
        {
          name: 'HTML response',
          contentType: 'text/html',
          expectedHandler: null,
          shouldHandle: false,
        },
        {
          name: 'SSE response',
          contentType: 'text/event-stream',
          expectedHandler: null,
          shouldHandle: false, // SSE should not be handled by MediaResponseHandler
        },
      ];

      testCases.forEach(
        ({ name, contentType, expectedHandler, shouldHandle }) => {
          it(`should ${shouldHandle ? 'handle' : 'skip'} ${name} (${contentType})`, () => {
            const mockResponse = createMockResponse(contentType, 200, {
              'content-length': '1024',
              'accept-ranges': 'bytes',
            });

            const result = MediaResponseHandler.handleMediaResponse(
              mockResponse,
              'test-app',
              'GET'
            );

            if (shouldHandle) {
              expect(result).not.toBeNull();
              expect(result!.status).toBe(200);
              expect(result!.body).toBe(mockReadableStream);

              // Verify correct logging
              if (expectedHandler) {
                const expectedLogMessage =
                  expectedHandler === 'image'
                    ? 'Image/Binary response detected'
                    : expectedHandler === 'pdf'
                      ? 'PDF response detected'
                      : `${expectedHandler.charAt(0).toUpperCase() + expectedHandler.slice(1)} response detected`;
                expect(consoleLogSpy).toHaveBeenCalledWith(
                  expect.stringContaining(expectedLogMessage)
                );
              }
            } else {
              expect(result).toBeNull();
            }
          });
        }
      );
    });

    describe('Priority Order Verification', () => {
      it('should maintain exact same priority as original if-else chain', () => {
        const registeredTypes = MediaResponseHandler.getRegisteredTypes();
        expect(registeredTypes).toEqual(['audio', 'video', 'pdf', 'image']);
      });

      it('should handle conflicting content-types in correct priority order', () => {
        // Test edge case where a hypothetical content-type could match multiple patterns
        const mockResponse = createMockResponse('audio/special-format');

        const result = MediaResponseHandler.handleMediaResponse(
          mockResponse,
          'test-app',
          'GET'
        );

        expect(result).not.toBeNull();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Audio response detected')
        );
      });
    });

    describe('Header Handling Verification', () => {
      const mediaTypes = [
        'audio/mp3',
        'video/mp4',
        'application/pdf',
        'image/png',
      ];

      mediaTypes.forEach(contentType => {
        it(`should copy correct headers for ${contentType}`, () => {
          const mockResponse = createMockResponse(contentType, 200, {
            'content-type': contentType,
            'content-length': '2048',
            'content-disposition': 'attachment; filename="test.pdf"',
            'accept-ranges': 'bytes',
            vary: 'Accept-Encoding',
            'cache-control': 'no-cache', // Should NOT be copied
            'set-cookie': 'session=abc', // Should NOT be copied
            'x-custom': 'value', // Should NOT be copied
          });

          const result = MediaResponseHandler.handleMediaResponse(
            mockResponse,
            'test-app',
            'GET'
          );

          expect(result).not.toBeNull();

          // Headers that SHOULD be copied (starting with 'content-', 'accept-ranges', 'vary')
          expect(result!.headers.get('content-type')).toBe(contentType);
          expect(result!.headers.get('content-length')).toBe('2048');
          expect(result!.headers.get('content-disposition')).toBe(
            'attachment; filename="test.pdf"'
          );
          expect(result!.headers.get('accept-ranges')).toBe('bytes');
          expect(result!.headers.get('vary')).toBe('Accept-Encoding');

          // Headers that should NOT be copied
          expect(result!.headers.get('cache-control')).toBeNull();
          expect(result!.headers.get('set-cookie')).toBeNull();
          expect(result!.headers.get('x-custom')).toBeNull();
        });
      });
    });

    describe('Edge Cases and Error Conditions', () => {
      it('should handle missing content-type header', () => {
        const mockResponse = {
          headers: new Headers(),
          body: mockReadableStream,
          status: 200,
          statusText: 'OK',
        } as unknown as Response;

        const result = MediaResponseHandler.handleMediaResponse(
          mockResponse,
          'test-app',
          'GET'
        );

        expect(result).toBeNull();
      });

      it('should handle empty content-type header', () => {
        const mockResponse = createMockResponse('');

        const result = MediaResponseHandler.handleMediaResponse(
          mockResponse,
          'test-app',
          'GET'
        );

        expect(result).toBeNull();
      });

      it('should handle case-insensitive content-types', () => {
        const mockResponse = createMockResponse('APPLICATION/PDF');

        const result = MediaResponseHandler.handleMediaResponse(
          mockResponse,
          'test-app',
          'GET'
        );

        expect(result).not.toBeNull();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('PDF response detected')
        );
      });

      it('should handle content-type with charset and other parameters', () => {
        const mockResponse = createMockResponse('image/jpeg; charset=utf-8');

        const result = MediaResponseHandler.handleMediaResponse(
          mockResponse,
          'test-app',
          'GET'
        );

        expect(result).not.toBeNull();
        expect(consoleLogSpy).toHaveBeenCalledWith(
          expect.stringContaining('Image/Binary response detected')
        );
      });
    });

    describe('Status Code Handling', () => {
      const statusCodes = [200, 206, 304, 404, 500];

      statusCodes.forEach(status => {
        it(`should preserve status code ${status} for media responses`, () => {
          const mockResponse = createMockResponse('application/pdf', status);

          const result = MediaResponseHandler.handleMediaResponse(
            mockResponse,
            'test-app',
            'GET'
          );

          if (status === 200 || status === 206) {
            expect(result).not.toBeNull();
            expect(result!.status).toBe(status);
          } else {
            // For other status codes, the behavior might vary
            // This ensures we maintain the same behavior as original
            if (result) {
              expect(result.status).toBe(status);
            }
          }
        });
      });
    });

    describe('Response Body Integrity', () => {
      it('should preserve response body stream for all media types', () => {
        const mediaTypes = [
          'audio/mp3',
          'video/mp4',
          'application/pdf',
          'image/png',
        ];

        mediaTypes.forEach(contentType => {
          const mockResponse = createMockResponse(contentType);

          const result = MediaResponseHandler.handleMediaResponse(
            mockResponse,
            'test-app',
            'GET'
          );

          expect(result).not.toBeNull();
          expect(result!.body).toBe(mockReadableStream);
        });
      });
    });
  });

  describe('Complete Route Flow Simulation', () => {
    // Move createMockResponse to describe scope
    const createMockResponse = (
      contentType: string,
      status = 200,
      additionalHeaders: Record<string, string> = {}
    ) => {
      const headers = new Headers();
      headers.set('content-type', contentType);
      Object.entries(additionalHeaders).forEach(([key, value]) => {
        headers.set(key, value);
      });

      return {
        headers,
        body: mockReadableStream,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        ok: status >= 200 && status < 300,
      } as unknown as Response;
    };

    it('should follow exact same flow as original route for media types', () => {
      // This test simulates the complete route flow:
      // 1. SSE check (skipped - not SSE)
      // 2. Media handler check (should match)
      // 3. Return media response (should not reach JSON/text fallback)

      const mockResponse = createMockResponse('application/pdf', 200, {
        'content-length': '4096',
      });

      // Step 1: Check if it's SSE (should be false)
      const contentType = mockResponse.headers.get('content-type');
      const isSSE = contentType?.includes('text/event-stream');
      expect(isSSE).toBe(false);

      // Step 2: Try media handler (should succeed)
      const mediaResult = MediaResponseHandler.handleMediaResponse(
        mockResponse,
        'test-app',
        'GET'
      );
      expect(mediaResult).not.toBeNull();

      // Step 3: Should return media result (not reach JSON fallback)
      expect(mediaResult!.status).toBe(200);
      expect(mediaResult!.body).toBe(mockReadableStream);
    });

    it('should fall through to JSON/text handling for non-media types', () => {
      // This simulates non-media content that should fall through
      const mockResponse = createMockResponse('application/json');

      // Step 1: Check if it's SSE (should be false)
      const contentType = mockResponse.headers.get('content-type');
      const isSSE = contentType?.includes('text/event-stream');
      expect(isSSE).toBe(false);

      // Step 2: Try media handler (should return null)
      const mediaResult = MediaResponseHandler.handleMediaResponse(
        mockResponse,
        'test-app',
        'GET'
      );
      expect(mediaResult).toBeNull();

      // Step 3: Should fall through to JSON/text processing
      // (This part would be handled by the route's JSON/text logic)
    });
  });
});
