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
    code: 'INTERNAL_STORAGE_CONTENT_IMAGES_PRESIGN_NEXT_DISABLED',
    userMessage:
      'Content image presign API is served by Fastify. Enable Fastify proxy/cutover to use this endpoint.',
    developerMessage:
      'Next.js content image presign route is disabled after Fastify convergence.',
    retryable: false,
  });
  return buildAppErrorEnvelope(detail, detail.userMessage);
}

function buildDisabledJson(status: number, requestId: string) {
  const response = NextResponse.json(buildDisabledResponse(status, requestId), {
    status,
    headers: {
      'Cache-Control': 'no-store',
    },
  });
  response.headers.set(REQUEST_ID_HEADER, requestId);
  response.headers.set('x-agentifui-storage-handler', 'next-disabled');
  return response;
}

export async function POST(_request: Request) {
  const requestId = resolveRequestId();
  return buildDisabledJson(503, requestId);
}

export async function GET(_request: Request) {
  const requestId = resolveRequestId();
  return buildDisabledJson(503, requestId);
}
