import { auth, isBetterAuthEnabled } from '@lib/auth/better-auth/server';
import { toNextJsHandler } from 'better-auth/next-js';

const handler = toNextJsHandler(auth);

function notEnabledResponse(): Response {
  return Response.json(
    { message: 'better-auth is disabled in this environment' },
    { status: 404 }
  );
}

export async function GET(request: Request) {
  if (!isBetterAuthEnabled) {
    return notEnabledResponse();
  }

  return handler.GET(request);
}

export async function POST(request: Request) {
  if (!isBetterAuthEnabled) {
    return notEnabledResponse();
  }

  return handler.POST(request);
}

export async function PATCH(request: Request) {
  if (!isBetterAuthEnabled) {
    return notEnabledResponse();
  }

  return handler.PATCH(request);
}

export async function PUT(request: Request) {
  if (!isBetterAuthEnabled) {
    return notEnabledResponse();
  }

  return handler.PUT(request);
}

export async function DELETE(request: Request) {
  if (!isBetterAuthEnabled) {
    return notEnabledResponse();
  }

  return handler.DELETE(request);
}
