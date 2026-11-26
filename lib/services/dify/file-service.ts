/**
 * Dify File Service
 * @description Implements interaction logic with Dify file upload and preview APIs
 * @module lib/services/dify/file-service
 */
import type {
  DifyFilePreviewOptions,
  DifyFilePreviewResponse,
  DifyFileUploadResponse,
} from './types';

// Points to our backend proxy API
const DIFY_API_BASE_URL = '/api/dify';

export function difyResultFilePath(
  appId: string,
  messageId: string,
  fileId: string
): string {
  return `${DIFY_API_BASE_URL}/${encodeURIComponent(appId)}/result-files/${encodeURIComponent(messageId)}/${encodeURIComponent(fileId)}`;
}

/**
 * Upload a single file to Dify (via backend proxy).
 *
 * @param appId - Dify application ID.
 * @param file - File object to upload.
 * @param user - User identifier required by Dify.
 * @returns A Promise resolving to DifyFileUploadResponse.
 * @throws Throws an error if the request fails or API returns an error status.
 */
export async function uploadDifyFile(
  appId: string,
  file: File,
  user: string
): Promise<DifyFileUploadResponse> {
  // Use XMLHttpRequest to support upload progress callback
  return new Promise((resolve, reject) => {
    const slug = 'files/upload';
    const apiUrl = `${DIFY_API_BASE_URL}/${appId}/${slug}`;
    const formData = new FormData();
    formData.append('file', file);
    formData.append('user', user);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl, true);

    // Progress events not needed - just show loading spinner

    xhr.onreadystatechange = () => {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const result: DifyFileUploadResponse = JSON.parse(xhr.responseText);
            resolve(result);
          } catch {
            reject(new Error('Failed to parse Dify file upload response'));
          }
        } else {
          let errorBody = xhr.responseText || 'Unknown error';
          let errorCode = 'UNKNOWN';
          try {
            const errorJson = JSON.parse(xhr.responseText);
            errorBody = JSON.stringify(errorJson);
            errorCode = errorJson.code || errorCode;
          } catch {}
          const error = new Error(
            `Failed to upload file "${file.name}". Status: ${xhr.status}. Code: ${errorCode}. Body: ${errorBody}`
          ) as Error & { code: string };
          error.code = errorCode;
          reject(error);
        }
      }
    };

    xhr.onerror = () => {
      reject(new Error(`File upload network error: ${xhr.status}`));
    };

    xhr.send(formData);
  });
}

/**
 * Preview or download a file from Dify API
 *
 * @param appId - Dify application ID
 * @param fileId - Unique identifier of the file to preview
 * @param options - Preview options (as_attachment, etc.)
 * @returns Promise containing file content and response headers
 * @throws Error if the request fails or API returns error status
 */
export async function previewDifyFile(
  appId: string,
  fileId: string,
  options: DifyFilePreviewOptions = {}
): Promise<DifyFilePreviewResponse> {
  const { as_attachment = false, resultMessageId } = options;

  // Build query parameters
  const searchParams = new URLSearchParams();
  if (as_attachment) {
    searchParams.append('as_attachment', 'true');
  }

  const queryString = searchParams.toString();
  const filePath = resultMessageId
    ? difyResultFilePath(appId, resultMessageId, fileId)
    : `${DIFY_API_BASE_URL}/${encodeURIComponent(appId)}/files/${encodeURIComponent(fileId)}/preview`;
  const apiUrl = `${filePath}${queryString ? `?${queryString}` : ''}`;

  try {
    const response = await fetch(apiUrl, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      redirect: 'error',
    });

    if (!response.ok) {
      let errorMessage = `Failed to preview file ${fileId}`;
      let errorCode = 'UNKNOWN';

      try {
        const errorBody = await response.text();
        const errorJson = JSON.parse(errorBody);
        errorCode =
          errorJson.code ||
          errorJson.app_error?.code ||
          response.status.toString();
        errorMessage = `${errorMessage}. Status: ${response.status}. Code: ${errorCode}. ${errorJson.message || errorJson.app_error?.userMessage || errorJson.error || errorBody}`;
      } catch {
        errorMessage = `${errorMessage}. Status: ${response.status}`;
      }

      const error = new Error(errorMessage) as Error & {
        status: number;
        code: string;
      };
      error.status = response.status;
      error.code = errorCode;
      throw error;
    }

    // Get the file content as blob
    const content = await response.blob();

    // Extract response headers
    const headers = {
      contentType:
        response.headers.get('Content-Type') || 'application/octet-stream',
      contentLength: response.headers.get('Content-Length')
        ? parseInt(response.headers.get('Content-Length')!, 10)
        : undefined,
      contentDisposition:
        response.headers.get('Content-Disposition') || undefined,
      cacheControl: response.headers.get('Cache-Control') || undefined,
      acceptRanges: response.headers.get('Accept-Ranges') || undefined,
    };

    return {
      content,
      headers,
    };
  } catch (error) {
    throw error;
  }
}

export {};
// Ensure the file is treated as a module
