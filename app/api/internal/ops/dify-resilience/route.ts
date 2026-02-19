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
    code: 'DIFY_RESILIENCE_OPS_NEXT_DISABLED',
    userMessage:
      'Dify resilience ops API is served by Fastify. Enable Fastify proxy/cutover to use this endpoint.',
    developerMessage:
      'Next.js dify resilience ops route is disabled after Fastify convergence.',
    retryable: false,
  });
  return buildAppErrorEnvelope(detail, detail.userMessage);
}

export async function GET(_request: Request) {
  const requestId = resolveRequestId();
  const response = NextResponse.json(buildDisabledResponse(503, requestId), {
    status: 503,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set('x-agentifui-dify-resilience-handler', 'next-disabled');
  return response;
}
