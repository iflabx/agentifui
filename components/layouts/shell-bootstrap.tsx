'use client';

import { getCurrentSession } from '@lib/auth/better-auth/http-client';
import { useCurrentAppStore } from '@lib/stores/current-app-store';

import { useEffect } from 'react';

export function ShellBootstrap() {
  const initializeDefaultAppId = useCurrentAppStore(
    state => state.initializeDefaultAppId
  );

  useEffect(() => {
    const checkUserAndInitialize = async () => {
      try {
        const sessionPayload = (await getCurrentSession()) as {
          user?: { id?: string } | null;
        } | null;
        const user = sessionPayload?.user ?? null;

        if (user?.id) {
          console.log(
            '[ShellBootstrap] User logged in, initializing app storage'
          );
          await initializeDefaultAppId();
        } else {
          console.log(
            '[ShellBootstrap] User not logged in, skipping app storage initialization'
          );
        }
      } catch (error) {
        console.warn('[ShellBootstrap] Checking user status failed:', error);
      }
    };

    void checkUserAndInitialize();
  }, [initializeDefaultAppId]);

  return null;
}
