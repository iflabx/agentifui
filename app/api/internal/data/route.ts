import {
  REQUEST_ID_HEADER,
  buildAppErrorDetail,
  buildAppErrorEnvelope,
  resolveRequestId,
} from '@lib/errors/app-error';

import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function buildDisabledResponse(status: number, requestId: string) {
  const detail = buildAppErrorDetail({
    status,
    source: 'next-api',
    requestId,
    code: 'INTERNAL_DATA_NEXT_DISABLED',
    userMessage:
      'Internal data API is served by Fastify. Enable Fastify proxy/cutover to use this endpoint.',
    developerMessage:
      'Next.js internal-data route is disabled after Fastify single-backend convergence.',
    retryable: false,
  });

  return buildAppErrorEnvelope(detail, detail.userMessage);
}

export async function POST(_request: Request) {
  const requestId = resolveRequestId();
  const response = NextResponse.json(buildDisabledResponse(503, requestId), {
    status: 503,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set('x-agentifui-internal-data-handler', 'next-disabled');
  return response;
}

export async function GET(request: Request) {
  return POST(request);
}
