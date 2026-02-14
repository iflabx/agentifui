'use client';

import { useAuthSession } from '@lib/auth/better-auth/react-hooks';

import { backendClient } from './client';

export function useBackendAuthSession() {
  return useAuthSession();
}

export function useBackendClient() {
  return backendClient;
}
