import {
  type AppErrorSource,
  REQUEST_ID_HEADER,
  buildAppErrorDetail,
  buildAppErrorEnvelope,
  resolveRequestId,
} from '@lib/errors/app-error';

import { NextResponse } from 'next/server';

interface NextApiErrorResponseInput {
  request?: Request | Headers;
  status: number;
  userMessage: string;
  code?: string;
  source?: AppErrorSource;
  developerMessage?: string;
  context?: Record<string, unknown>;
  retryable?: boolean;
  legacyMessage?: string;
  extra?: Record<string, unknown>;
  headers?: HeadersInit;
}

export function nextApiErrorResponse(
  input: NextApiErrorResponseInput
): NextResponse {
  const requestId = resolveRequestId(input.request);
  const detail = buildAppErrorDetail({
    status: input.status,
    code: input.code,
    source: input.source || 'next-api',
    userMessage: input.userMessage,
    developerMessage: input.developerMessage,
    context: input.context,
    retryable: input.retryable,
    requestId,
  });
  const response = NextResponse.json(
    {
      ...buildAppErrorEnvelope(
        detail,
        input.legacyMessage || input.userMessage
      ),
      ...(input.extra || {}),
    },
    {
      status: input.status,
      headers: input.headers,
    }
  );
  response.headers.set(REQUEST_ID_HEADER, requestId);
  return response;
}
