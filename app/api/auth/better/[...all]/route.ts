import { auth } from '@lib/auth/better-auth/server';
import '@lib/server/realtime/runtime-registry';
import { toNextJsHandler } from 'better-auth/next-js';

import { syncPostAuthIdentityIfNeeded } from './route-helpers/identity-sync';
import { handleBetterAuthPost } from './route-helpers/local-login';

const handler = toNextJsHandler(auth);

export async function GET(request: Request) {
  const response = await handler.GET(request);
  await syncPostAuthIdentityIfNeeded(request, response);
  return response;
}

export async function POST(request: Request) {
  return handleBetterAuthPost(request, handler);
}

export async function PATCH(request: Request) {
  return handler.PATCH(request);
}

export async function PUT(request: Request) {
  return handler.PUT(request);
}

export async function DELETE(request: Request) {
  return handler.DELETE(request);
}
