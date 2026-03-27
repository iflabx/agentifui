'use client';

import { getCurrentSession } from '@lib/auth/better-auth/http-client';
import { useCurrentAppStore } from '@lib/stores/current-app-store';
import { logCurrentAppDebugSnapshot } from '@lib/utils/current-app-debug';

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
          const beforeState = useCurrentAppStore.getState();
          logCurrentAppDebugSnapshot(
            '[CurrentAppDebug] ShellBootstrap before init',
            {
              source: 'components/layouts/shell-bootstrap',
              currentAppId: beforeState.currentAppId,
              currentAppInstanceId:
                beforeState.currentAppInstance?.instance_id ?? null,
              currentAppDisplayName:
                beforeState.currentAppInstance?.display_name ?? null,
              note: 'before initializeDefaultAppId',
            }
          );
          await initializeDefaultAppId();
          const afterState = useCurrentAppStore.getState();
          logCurrentAppDebugSnapshot(
            '[CurrentAppDebug] ShellBootstrap after init',
            {
              source: 'components/layouts/shell-bootstrap',
              currentAppId: afterState.currentAppId,
              currentAppInstanceId:
                afterState.currentAppInstance?.instance_id ?? null,
              currentAppDisplayName:
                afterState.currentAppInstance?.display_name ?? null,
              note: 'after initializeDefaultAppId',
            }
          );
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
