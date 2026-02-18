import { MediaResponseHandler } from '@lib/api/dify/handlers/media-response-handler';
import { resolveSessionIdentity } from '@lib/auth/better-auth/session-identity';
import { getDifyAppConfig } from '@lib/config/dify-config';
import { type DifyAppConfig } from '@lib/config/dify-config';
import {
  REQUEST_ID_HEADER,
  buildAppErrorDetail,
  buildAppErrorEnvelope,
  resolveRequestId,
} from '@lib/errors/app-error';
import { fetchWithDifyProxyResilience } from '@lib/server/dify/proxy-resilience';
import { recordErrorEvent } from '@lib/server/errors/error-events';
import {
  runWithRequestErrorContext,
  updateRequestErrorContext,
} from '@lib/server/errors/request-context';
import {
  type AgentErrorSource,
  toUserFacingAgentError,
} from '@lib/services/agent-error/user-facing-error';
import {
  type DifyAppType,
  isTextGenerationApp,
  isWorkflowApp,
} from '@lib/types/dify-app-types';

import { type NextRequest, NextResponse } from 'next/server';

// app/api/dify/[appId]/[...slug]/route.ts
export const dynamic = 'force-dynamic';

// define interface for route parameters
interface DifyApiParams {
  appId: string;
  slug: string[];
}

type ErrorPayloadObject = Record<string, unknown>;

/**
 * 🎯 New: Function to adjust API path based on Dify app type
 * Different types of Dify apps use different API endpoints
 */
function adjustApiPathByAppType(
  slug: string[],
  appType: string | undefined
): string {
  const originalPath = slug.join('/');

  if (!appType) {
    return originalPath; // if no app type info, keep original path
  }

  // workflow apps: need workflows prefix, but exclude common APIs
  if (isWorkflowApp(appType as DifyAppType)) {
    // common APIs like file upload, audio-to-text don't need workflows prefix
    const commonApis = ['files/upload', 'audio-to-text'];
    const isCommonApi = commonApis.some(api => originalPath.startsWith(api));

    if (!isCommonApi && !originalPath.startsWith('workflows/')) {
      return `workflows/${originalPath}`;
    }
  }

  // text generation apps: use completion-messages endpoint
  if (isTextGenerationApp(appType as DifyAppType)) {
    if (originalPath === 'messages' || originalPath === 'chat-messages') {
      return 'completion-messages';
    }
    if (originalPath.startsWith('chat-messages')) {
      return originalPath.replace('chat-messages', 'completion-messages');
    }
  }

  return originalPath;
}

function inferAgentSource(slugPath: string): AgentErrorSource {
  if (slugPath.startsWith('workflows/')) {
    return 'dify-workflow';
  }

  if (slugPath.startsWith('completion-messages')) {
    return 'dify-completion';
  }

  if (slugPath.startsWith('chat-messages')) {
    return 'dify-chat';
  }

  return 'agent-generic';
}

function extractErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const maybeCode = (payload as ErrorPayloadObject).code;
  return typeof maybeCode === 'string' ? maybeCode : null;
}

function extractErrorMessage(payload: unknown): string | null {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    return trimmed || null;
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }

  const errorPayload = payload as ErrorPayloadObject;

  const messageCandidates = [
    errorPayload.message,
    errorPayload.error,
    errorPayload.details,
  ];
  for (const candidate of messageCandidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }

  const nestedData = errorPayload.data;
  if (
    nestedData &&
    typeof nestedData === 'object' &&
    !Array.isArray(nestedData)
  ) {
    const nestedDataObject = nestedData as ErrorPayloadObject;
    const status = nestedDataObject.status;
    if (status === 'failed') {
      const nestedError = nestedDataObject.error;
      if (typeof nestedError === 'string' && nestedError.trim().length > 0) {
        return nestedError.trim();
      }
    }
  }

  return null;
}

function withAgentErrorEnvelope(
  payload: unknown,
  context: {
    source: AgentErrorSource;
    status: number;
    locale?: string;
    requestId: string;
    route: string;
    method: string;
    actorUserId?: string;
  }
): unknown {
  const rawMessage = extractErrorMessage(payload);
  if (!rawMessage) {
    return payload;
  }

  const errorEnvelope = toUserFacingAgentError({
    source: context.source,
    status: context.status,
    code: extractErrorCode(payload),
    message: rawMessage,
    locale: context.locale,
  });
  const appError = buildAppErrorDetail({
    status: context.status,
    code: errorEnvelope.code,
    source: 'dify-proxy',
    requestId: context.requestId,
    userMessage: errorEnvelope.userMessage,
    developerMessage: rawMessage,
    retryable: errorEnvelope.retryable,
    context: {
      agent_source: errorEnvelope.source,
      agent_kind: errorEnvelope.kind,
      suggestion: errorEnvelope.suggestion,
    },
  });
  const appEnvelope = buildAppErrorEnvelope(appError, rawMessage);

  void recordErrorEvent({
    code: appError.code,
    source: appError.source,
    severity: appError.severity,
    retryable: appError.retryable,
    userMessage: appError.userMessage,
    developerMessage: appError.developerMessage,
    requestId: context.requestId,
    actorUserId: context.actorUserId,
    httpStatus: context.status,
    method: context.method,
    route: context.route,
    context: appError.context,
  }).catch(error => {
    console.warn(
      '[Dify API] failed to record error event:',
      error instanceof Error ? error.message : String(error)
    );
  });

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {
      ...appEnvelope,
      agent_error: errorEnvelope,
    };
  }

  return {
    ...(payload as ErrorPayloadObject),
    ...appEnvelope,
    agent_error: errorEnvelope,
  };
}

function withRequestIdHeader<T extends Response>(
  response: T,
  requestId: string
): T {
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}

function resolveRequestLocale(req: NextRequest): string | undefined {
  const languageHeader = req.headers.get('accept-language');
  if (!languageHeader) {
    return undefined;
  }

  const firstItem = languageHeader.split(',')[0]?.trim();
  if (!firstItem) {
    return undefined;
  }

  return firstItem;
}

// helper function: create minimal response headers with Content-Type
function createMinimalHeaders(contentType?: string): Headers {
  const headers = new Headers();

  // set Content-Type if provided
  if (contentType) {
    headers.set('Content-Type', contentType);
  }
  return headers;
}

// core helper function: execute proxy request to Dify
async function proxyToDify(
  req: NextRequest, // original Next.js request object
  // modification point 1: receive context object containing params
  context: { params: Promise<DifyApiParams> }, // Unified use of Promise type
  requestId: string
) {
  // modification point 2: use await to get the value of params
  const params = await context.params;
  const appId = params.appId;
  const slug = params.slug;
  const routePath = `/api/dify/${appId}/${slug.join('/')}`;
  const requestLocale = resolveRequestLocale(req);

  // Security: resolve user identity via the unified auth->internal UUID path.
  const resolvedIdentity = await resolveSessionIdentity(req.headers);
  if (!resolvedIdentity.success) {
    console.warn(
      '[Dify API] Failed to resolve session identity:',
      resolvedIdentity.error
    );
    const payload = withAgentErrorEnvelope(
      { error: 'Unauthorized' },
      {
        source: 'agent-generic',
        status: 401,
        locale: requestLocale,
        requestId,
        route: routePath,
        method: req.method,
      }
    );
    return NextResponse.json(payload, { status: 401 });
  }

  if (!resolvedIdentity.data) {
    console.log(`[Dify API] Unauthorized access attempt to appId: ${appId}`);
    const payload = withAgentErrorEnvelope(
      { error: 'Unauthorized' },
      {
        source: 'agent-generic',
        status: 401,
        locale: requestLocale,
        requestId,
        route: routePath,
        method: req.method,
      }
    );
    return NextResponse.json(payload, { status: 401 });
  }
  updateRequestErrorContext({ actorUserId: resolvedIdentity.data.userId });

  // check if there is temporary configuration (for form synchronization)
  // if the request body contains _temp_config, use temporary configuration instead of database configuration
  // avoid reading the request body repeatedly, clone the request to preserve the original request body
  let tempConfig: { apiUrl: string; apiKey: string } | null = null;
  let requestBody: Record<string, unknown> | null = null;

  if (req.method === 'POST') {
    try {
      // clone request to avoid consuming original request body
      const clonedReq = req.clone();
      const body = await clonedReq.json();
      requestBody = body; // Save parsed request body

      if (
        body._temp_config &&
        body._temp_config.apiUrl &&
        body._temp_config.apiKey
      ) {
        tempConfig = body._temp_config;
        console.log(
          `[App: ${appId}] [${req.method}] temporary configuration detected, using form provided configuration`
        );

        // Remove temporary configuration fields to avoid passing to Dify API
        requestBody = body;
      }
    } catch {
      // if parsing the request body fails, continue using normal process
      console.log(
        `[App: ${appId}] [${req.method}] Failed to parse request body, using normal configuration process`
      );
      requestBody = null;
    }
  }

  // validate slug to prevent constructing invalid target URLs
  if (!slug || slug.length === 0) {
    console.error(
      `[App: ${appId}] [${req.method}] Invalid request: Slug path is missing.`
    );
    const errorPayload = withAgentErrorEnvelope(
      { error: 'Invalid request: slug path is missing.' },
      {
        source: 'agent-generic',
        status: 400,
        locale: requestLocale,
        requestId,
        route: routePath,
        method: req.method,
      }
    );
    const baseResponse = new Response(JSON.stringify(errorPayload), {
      status: 400,
      headers: createMinimalHeaders('application/json'), // use helper function
    });

    return baseResponse;
  }

  // 1. Get Dify app configuration
  // use temporary configuration (form synchronization) first, otherwise get from database
  let difyApiKey: string;
  let difyApiUrl: string;
  let difyConfig: DifyAppConfig | null = null;

  if (tempConfig) {
    // use temporary configuration
    console.log(
      `[App: ${appId}] [${req.method}] Using temporary configuration`
    );
    difyApiKey = tempConfig.apiKey;
    difyApiUrl = tempConfig.apiUrl;
  } else {
    // get configuration from database
    console.log(
      `[App: ${appId}] [${req.method}] Getting configuration from database...`
    );
    difyConfig = await getDifyAppConfig(appId, false, {
      actorUserId: resolvedIdentity.data.userId,
    });

    // validate database configuration
    if (!difyConfig) {
      console.error(`[App: ${appId}] [${req.method}] Configuration not found.`);
      // return 400 Bad Request, indicating that the provided appId is invalid or not configured
      const payload = withAgentErrorEnvelope(
        { error: `Configuration for Dify app '${appId}' not found.` },
        {
          source: 'agent-generic',
          status: 400,
          locale: requestLocale,
          requestId,
          route: routePath,
          method: req.method,
          actorUserId: resolvedIdentity.data.userId,
        }
      );
      const baseResponse = NextResponse.json(payload, { status: 400 });

      return baseResponse;
    }

    difyApiKey = difyConfig.apiKey;
    difyApiUrl = difyConfig.apiUrl;
  }

  // check if the obtained key and url are valid again
  if (!difyApiKey || !difyApiUrl) {
    console.error(
      `[App: ${appId}] [${req.method}] Invalid configuration loaded (missing key or URL).`
    );
    // return 500 Internal Server Error, indicating server-side configuration issues
    const payload = withAgentErrorEnvelope(
      { error: `Server configuration error for app '${appId}'.` },
      {
        source: 'agent-generic',
        status: 500,
        locale: requestLocale,
        requestId,
        route: routePath,
        method: req.method,
        actorUserId: resolvedIdentity.data.userId,
      }
    );
    const baseResponse = NextResponse.json(payload, { status: 500 });

    return baseResponse;
  }
  console.log(
    `[App: ${appId}] [${req.method}] Configuration loaded successfully.`
  );

  try {
    // construct target Dify URL
    const slugPath = adjustApiPathByAppType(slug, difyConfig?.appType);
    const agentSource = inferAgentSource(slugPath);
    const targetUrl = `${difyApiUrl}/${slugPath}${req.nextUrl.search}`;
    console.log(
      `[App: ${appId}] [${req.method}] Proxying request to target URL: ${targetUrl}`
    );

    // prepare forwarding request headers
    const headers = new Headers();
    // only copy necessary request headers
    if (req.headers.get('Content-Type')) {
      headers.set('Content-Type', req.headers.get('Content-Type')!);
    }
    if (req.headers.get('Accept')) {
      headers.set('Accept', req.headers.get('Accept')!);
    }
    // add Dify authentication header
    headers.set('Authorization', `Bearer ${difyApiKey}`);
    // add other fixed request headers as needed

    // execute fetch request forwarding
    // prepare request body and headers, handle special cases
    let finalBody: BodyInit | null = null;

    // handle request body: use previously parsed and cleaned request body
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      if (tempConfig) {
        // when using temporary configuration, the request body should be empty (because these are info/parameters query requests)
        finalBody = null;
      } else if (requestBody !== null) {
        // use previously parsed request body
        finalBody = JSON.stringify(requestBody);
      } else {
        // if no request body has been parsed, use the original request body
        finalBody = req.body;
      }
    }

    const finalHeaders = new Headers(headers);
    const originalContentType = req.headers.get('Content-Type');

    // special handling for multipart/form-data requests (file upload and audio-to-text)
    if (
      (slugPath === 'files/upload' || slugPath === 'audio-to-text') &&
      originalContentType?.includes('multipart/form-data')
    ) {
      console.log(
        `[App: ${appId}] [${req.method}] Handling multipart/form-data for ${slugPath}`
      );
      try {
        // parse form data
        const formData = await req.formData();
        finalBody = formData;
        // important: remove Content-Type, let fetch automatically set multipart/form-data with correct boundary
        finalHeaders.delete('Content-Type');
      } catch (formError) {
        console.error(
          `[App: ${appId}] [${req.method}] Error parsing FormData:`,
          formError
        );
        const payload = withAgentErrorEnvelope(
          {
            error: 'Failed to parse multipart form data',
            details: (formError as Error).message,
          },
          {
            source: agentSource,
            status: 400,
            locale: requestLocale,
            requestId,
            route: routePath,
            method: req.method,
            actorUserId: resolvedIdentity.data.userId,
          }
        );
        return NextResponse.json(payload, { status: 400 });
      }
    }

    // prepare fetch options
    // temporary configuration requests should use GET method to call Dify API
    const actualMethod = tempConfig ? 'GET' : req.method;

    const fetchOptions: RequestInit & { duplex: 'half' } = {
      method: actualMethod,
      headers: finalHeaders,
      body: finalBody,
      redirect: 'manual',
      cache: 'no-store',
      // [important] add duplex option and use type assertion to solve TS(2769)
      duplex: 'half',
    };

    const resilienceResult = await fetchWithDifyProxyResilience({
      circuitKey: `${appId}:${difyApiUrl}`,
      requestSignal: req.signal,
      execute: async signal => {
        const requestInit: RequestInit & { duplex?: 'half' } = {
          ...fetchOptions,
          signal,
        };
        return fetch(targetUrl, requestInit);
      },
    });

    if (!resilienceResult.ok) {
      if (resilienceResult.reason === 'circuit-open') {
        const payload = withAgentErrorEnvelope(
          {
            code: 'DIFY_CIRCUIT_OPEN',
            message:
              'Dify upstream is temporarily unavailable. Please retry later.',
            error:
              'Dify upstream is temporarily unavailable. Please retry later.',
          },
          {
            source: agentSource,
            status: 503,
            locale: requestLocale,
            requestId,
            route: routePath,
            method: req.method,
            actorUserId: resolvedIdentity.data.userId,
          }
        );
        const baseResponse = NextResponse.json(payload, { status: 503 });
        if (
          typeof resilienceResult.retryAfterSeconds === 'number' &&
          resilienceResult.retryAfterSeconds > 0
        ) {
          baseResponse.headers.set(
            'Retry-After',
            String(resilienceResult.retryAfterSeconds)
          );
        }
        return baseResponse;
      }

      if (resilienceResult.reason === 'timeout') {
        const payload = withAgentErrorEnvelope(
          {
            code: 'DIFY_UPSTREAM_TIMEOUT',
            message: 'Dify upstream request timed out.',
            error: 'Dify upstream request timed out.',
          },
          {
            source: agentSource,
            status: 504,
            locale: requestLocale,
            requestId,
            route: routePath,
            method: req.method,
            actorUserId: resolvedIdentity.data.userId,
          }
        );
        return NextResponse.json(payload, { status: 504 });
      }

      if (resilienceResult.reason === 'client-abort') {
        return new Response(null, {
          status: 499,
          statusText: 'Client Closed Request',
          headers: createMinimalHeaders(),
        });
      }

      throw (
        resilienceResult.error ||
        new Error('Failed to connect to Dify upstream')
      );
    }

    const response = resilienceResult.response;
    console.log(
      `[App: ${appId}] [${req.method}] Dify response status: ${response.status}`
    );

    // handle successful 204 No Content responses directly
    if (response.status === 204) {
      console.log(
        `[App: ${appId}] [${req.method}] Received 204 No Content, forwarding response directly.`
      );
      // forward 204 status and necessary response headers, ensure body is null
      // clone headers to forward
      const headersToForward = new Headers();
      response.headers.forEach((value, key) => {
        // avoid forwarding headers meaningless or invalid for 204, such as content-length, content-type
        if (
          !['content-length', 'content-type', 'transfer-encoding'].includes(
            key.toLowerCase()
          )
        ) {
          headersToForward.set(key, value);
        }
      });

      // return 204 response, body must be null, middleware will automatically add CORS headers
      const baseResponse = new Response(null, {
        status: 204,
        statusText: 'No Content',
        headers: headersToForward,
      });

      return baseResponse;
    }

    // handle and forward Dify'
    if (response.ok && response.body) {
      const responseContentType = response.headers.get('content-type');

      // handle streaming responses (SSE) - use manual read/write for enhanced robustness
      if (responseContentType?.includes('text/event-stream')) {
        console.log(
          `[App: ${appId}] [${req.method}] Streaming response detected. Applying robust handling.`
        );

        // keep SSE headers returned by Dify, and supplement our standard CORS headers
        const sseHeaders = createMinimalHeaders(); // start with minimal CORS headers
        response.headers.forEach((value, key) => {
          // copy essential SSE headers from Dify response
          if (
            key.toLowerCase() === 'content-type' ||
            key.toLowerCase() === 'cache-control' ||
            key.toLowerCase() === 'connection'
          ) {
            sseHeaders.set(key, value);
          }
        });

        // create a new readable stream, used to manually push data blocks to the client
        const stream = new ReadableStream({
          async start(controller) {
            console.log(
              `[App: ${appId}] [${req.method}] SSE Stream: Starting to read from Dify.`
            );
            const reader = response.body!.getReader(); // ensure response.body exists

            // handle client disconnection
            req.signal.addEventListener('abort', () => {
              console.log(
                `[App: ${appId}] [${req.method}] SSE Stream: Client disconnected, cancelling Dify read.`
              );
              reader.cancel('Client disconnected');
              // note: controller may already be closed, trying to close here may cause an error, but is usually harmless
              try {
                controller.close();
              } catch {
                /* Ignore */
              }
            });

            try {
              while (true) {
                // check if the client has disconnected
                if (req.signal.aborted) {
                  console.log(
                    `[App: ${appId}] [${req.method}] SSE Stream: Abort signal detected before read, stopping.`
                  );
                  // no need to manually cancel reader, cancel in addEventListener will handle it
                  break;
                }

                const { done, value } = await reader.read();

                if (done) {
                  console.log(
                    `[App: ${appId}] [${req.method}] SSE Stream: Dify stream finished.`
                  );
                  break; // dify stream finished, exit loop
                }

                // push the data block read from Dify to the stream we created
                controller.enqueue(value);
                // optional: print decoded data blocks for debugging
                // console.log(`[App: ${appId}] [${req.method}] SSE Chunk:`, decoder.decode(value, { stream: true }));
              }
            } catch (error) {
              // if an error occurs while reading the Dify stream (e.g. Dify server disconnected)
              console.error(
                `[App: ${appId}] [${req.method}] SSE Stream: Error reading from Dify stream:`,
                error
              );
              // trigger an error on the stream we created, notify downstream consumers
              controller.error(error);
            } finally {
              console.log(
                `[App: ${appId}] [${req.method}] SSE Stream: Finalizing stream controller.`
              );
              // ensure the controller is closed regardless (if not already closed or errored)
              try {
                controller.close();
              } catch {
                /* Ignore if already closed or errored */
              }
              // ensure reader is released (cancel will also release the lock, this is a double check)
              // reader.releaseLock(); // reader will automatically release after done=true or error
            }
          },
          cancel(reason) {
            console.log(
              `[App: ${appId}] [${req.method}] SSE Stream: Our stream was cancelled. Reason:`,
              reason
            );
            // if the stream we created is cancelled (e.g. cancel() is called on the Response object)
            // if needed, additional cleanup logic can be added here.
          },
        });

        // return the response containing the stream we manually created, middleware will automatically add CORS headers
        const baseResponse = new Response(stream, {
          status: response.status,
          statusText: response.statusText,
          headers: sseHeaders,
        });

        return baseResponse;
      }

      // Try to handle as media response (audio, video, PDF, image) using centralized handler
      else {
        const mediaResponse = MediaResponseHandler.handleMediaResponse(
          response,
          appId,
          req.method
        );

        if (mediaResponse) {
          return mediaResponse;
        }

        // handle regular response (mainly JSON or Text) - fallback when not a media type
        // handle non-streaming response
        const responseData = await response.text();
        try {
          const jsonData = JSON.parse(responseData);
          const payloadWithFriendlyError = withAgentErrorEnvelope(jsonData, {
            source: agentSource,
            status: response.status,
            locale: requestLocale,
            requestId,
            route: routePath,
            method: req.method,
            actorUserId: resolvedIdentity.data.userId,
          });
          console.log(
            `[App: ${appId}] [${req.method}] Returning native Response with minimal headers for success JSON.`
          );
          // use minimal header helper
          const baseResponse = new Response(
            JSON.stringify(payloadWithFriendlyError),
            {
              status: response.status,
              statusText: response.statusText,
              headers: createMinimalHeaders('application/json'), // use helper function
            }
          );

          return baseResponse;
        } catch {
          // not JSON, return text
          console.log(
            `[App: ${appId}] [${req.method}] JSON parse failed, returning plain text with minimal headers.`
          );
          // use minimal header helper
          const originalDifyContentType =
            response.headers.get('content-type') || 'text/plain';
          const baseResponse = new Response(responseData, {
            status: response.status,
            statusText: response.statusText,
            headers: createMinimalHeaders(originalDifyContentType), // use helper function and pass original type
          });

          return baseResponse;
        }
      }
    } else {
      // handle cases with no response body or failure
      if (!response.body) {
        console.log(
          `[App: ${appId}] [${req.method}] Empty response body with status: ${response.status}`
        );
      }
      // try to read error information
      try {
        const errorText = await response.text();
        try {
          const errorJson = JSON.parse(errorText);
          const payloadWithFriendlyError = withAgentErrorEnvelope(errorJson, {
            source: agentSource,
            status: response.status,
            locale: requestLocale,
            requestId,
            route: routePath,
            method: req.method,
            actorUserId: resolvedIdentity.data.userId,
          });
          console.log(
            `[App: ${appId}] [${req.method}] Returning native Response with minimal headers for error JSON.`
          );
          // use minimal header helper
          const baseResponse = new Response(
            JSON.stringify(payloadWithFriendlyError),
            {
              status: response.status,
              statusText: response.statusText,
              headers: createMinimalHeaders('application/json'),
            }
          );

          return baseResponse;
        } catch {
          // error response is not JSON, return json envelope for stable client parsing
          const payloadWithFriendlyError = withAgentErrorEnvelope(errorText, {
            source: agentSource,
            status: response.status,
            locale: requestLocale,
            requestId,
            route: routePath,
            method: req.method,
            actorUserId: resolvedIdentity.data.userId,
          });
          console.log(
            `[App: ${appId}] [${req.method}] Error response is not JSON, returning normalized JSON error envelope.`
          );
          const baseResponse = new Response(
            JSON.stringify(payloadWithFriendlyError),
            {
              status: response.status,
              statusText: response.statusText,
              headers: createMinimalHeaders('application/json'),
            }
          );

          return baseResponse;
        }
      } catch (readError) {
        // if even reading the error response fails
        console.error(
          `[App: ${appId}] [${req.method}] Failed to read Dify error response body:`,
          readError
        );
        const fallbackError = withAgentErrorEnvelope(
          {
            error: `Failed to read Dify error response body. Status: ${response.status}`,
            details:
              readError instanceof Error
                ? readError.message
                : String(readError),
          },
          {
            source: agentSource,
            status: response.status,
            locale: requestLocale,
            requestId,
            route: routePath,
            method: req.method,
            actorUserId: resolvedIdentity.data.userId,
          }
        );
        const finalErrorHeaders = createMinimalHeaders('application/json');
        const baseResponse = new Response(JSON.stringify(fallbackError), {
          status: 502,
          headers: finalErrorHeaders,
        });

        return baseResponse;
      }
    }
  } catch (error) {
    // catch errors in fetch or response processing
    console.error(
      `[App: ${appId}] [${req.method}] Dify proxy fetch/processing error:`,
      error
    );
    const fallbackError = withAgentErrorEnvelope(
      {
        error: `Failed to connect or process response from Dify service for app '${appId}' during ${req.method}.`,
        details: error instanceof Error ? error.message : 'Unknown error',
      },
      {
        source: 'agent-generic',
        status: 502,
        locale: resolveRequestLocale(req),
        requestId,
        route: routePath,
        method: req.method,
        actorUserId: resolvedIdentity.data.userId,
      }
    );
    const baseResponse = NextResponse.json(
      fallbackError,
      { status: 502 } // 502 Bad Gateway
    );

    return baseResponse;
  }
}

// export corresponding HTTP method handler functions
// create handler functions that meet the requirements of Next.js 15 for each HTTP method

export async function GET(
  req: NextRequest,
  context: { params: Promise<DifyApiParams> }
) {
  const requestId = resolveRequestId(req);
  return runWithRequestErrorContext(
    {
      requestId,
      source: 'dify-proxy',
      route: req.nextUrl.pathname,
      method: req.method,
    },
    async () =>
      withRequestIdHeader(await proxyToDify(req, context, requestId), requestId)
  );
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<DifyApiParams> }
) {
  const requestId = resolveRequestId(req);
  return runWithRequestErrorContext(
    {
      requestId,
      source: 'dify-proxy',
      route: req.nextUrl.pathname,
      method: req.method,
    },
    async () =>
      withRequestIdHeader(await proxyToDify(req, context, requestId), requestId)
  );
}

export async function PUT(
  req: NextRequest,
  context: { params: Promise<DifyApiParams> }
) {
  const requestId = resolveRequestId(req);
  return runWithRequestErrorContext(
    {
      requestId,
      source: 'dify-proxy',
      route: req.nextUrl.pathname,
      method: req.method,
    },
    async () =>
      withRequestIdHeader(await proxyToDify(req, context, requestId), requestId)
  );
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<DifyApiParams> }
) {
  const requestId = resolveRequestId(req);
  return runWithRequestErrorContext(
    {
      requestId,
      source: 'dify-proxy',
      route: req.nextUrl.pathname,
      method: req.method,
    },
    async () =>
      withRequestIdHeader(await proxyToDify(req, context, requestId), requestId)
  );
}

export async function PATCH(
  req: NextRequest,
  context: { params: Promise<DifyApiParams> }
) {
  const requestId = resolveRequestId(req);
  return runWithRequestErrorContext(
    {
      requestId,
      source: 'dify-proxy',
      route: req.nextUrl.pathname,
      method: req.method,
    },
    async () =>
      withRequestIdHeader(await proxyToDify(req, context, requestId), requestId)
  );
}

/**
 * Explicit OPTIONS handler
 * @description add explicit OPTIONS request handler to ensure CORS preflight requests respond correctly in various deployment environments
 */
export async function OPTIONS() {
  console.log('[OPTIONS Request] Responding to preflight request.');
  const requestId = resolveRequestId();
  const baseResponse = new Response(null, {
    status: 204, // no content for preflight
    headers: createMinimalHeaders(),
  });
  baseResponse.headers.set(REQUEST_ID_HEADER, requestId);

  return baseResponse;
}
