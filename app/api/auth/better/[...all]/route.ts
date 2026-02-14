import { auth } from '@lib/auth/better-auth/server';
import { toNextJsHandler } from 'better-auth/next-js';

const handler = toNextJsHandler(auth);

export async function GET(request: Request) {
  return handler.GET(request);
}

export async function POST(request: Request) {
  return handler.POST(request);
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
