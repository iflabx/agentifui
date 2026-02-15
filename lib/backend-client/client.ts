import {
  getCurrentSession,
  getCurrentUser,
  requestPasswordReset,
  resetPasswordWithToken,
  sendPhoneOtp,
  signInWithEmailPassword,
  signInWithSocialProvider,
  signInWithSsoProvider,
  signOutCurrentSession,
  signUpWithEmail,
  verifyPhoneOtp,
} from '@lib/auth/better-auth/http-client';
import { callInternalDataAction } from '@lib/db/internal-data-api';
import {
  type SubscriptionConfig,
  SubscriptionConfigs,
  SubscriptionKeys,
  realtimeService,
} from '@lib/services/db/realtime-service';

import { fetchJson } from './http';

type AppVisibility = 'public' | 'group_only' | 'private';

export const backendClient = {
  auth: {
    getCurrentSession,
    getCurrentUser,
    signInWithEmailPassword,
    signUpWithEmail,
    signInWithSocialProvider,
    signInWithSsoProvider,
    signOutCurrentSession,
    requestPasswordReset,
    resetPasswordWithToken,
    sendPhoneOtp,
    verifyPhoneOtp,
  },
  data: {
    action: callInternalDataAction,
  },
  apps: {
    list: () => fetchJson('/api/internal/apps?scope=all', { method: 'GET' }),
    listPublic: () =>
      fetchJson('/api/internal/apps?scope=public', { method: 'GET' }),
    getDefault: () =>
      fetchJson('/api/internal/apps?mode=default', { method: 'GET' }),
    getByInstance: (instanceId: string) =>
      fetchJson(
        `/api/internal/apps?instanceId=${encodeURIComponent(instanceId)}`,
        {
          method: 'GET',
        }
      ),
    updateVisibility: (id: string, visibility: AppVisibility) =>
      fetchJson('/api/internal/apps', {
        method: 'PATCH',
        body: JSON.stringify({ id, visibility }),
      }),
  },
  storage: {
    presignAvatarUpload: (payload: {
      userId: string;
      fileName: string;
      contentType: string;
      fileSize: number;
      expiresInSeconds?: number;
    }) =>
      fetchJson('/api/internal/storage/avatar/presign', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    commitAvatarUpload: (payload: { userId: string; path: string }) =>
      fetchJson('/api/internal/storage/avatar', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    presignAvatarDownload: (payload: {
      userId?: string;
      path: string;
      expiresInSeconds?: number;
    }) => {
      const params = new URLSearchParams();
      params.set('path', payload.path);
      if (payload.userId) {
        params.set('userId', payload.userId);
      }
      if (typeof payload.expiresInSeconds === 'number') {
        params.set('expiresInSeconds', String(payload.expiresInSeconds));
      }
      return fetchJson(
        `/api/internal/storage/avatar/presign?${params.toString()}`,
        {
          method: 'GET',
        }
      );
    },
    uploadAvatar: async (file: File, userId: string) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', userId);
      return fetchJson('/api/internal/storage/avatar', {
        method: 'POST',
        body: formData,
      });
    },
    deleteAvatar: (filePath: string, userId: string) =>
      fetchJson('/api/internal/storage/avatar', {
        method: 'DELETE',
        body: JSON.stringify({ filePath, userId }),
      }),
    presignContentImageUpload: (payload: {
      userId: string;
      fileName: string;
      contentType: string;
      fileSize: number;
      expiresInSeconds?: number;
    }) =>
      fetchJson('/api/internal/storage/content-images/presign', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    commitContentImageUpload: (payload: { userId: string; path: string }) =>
      fetchJson('/api/internal/storage/content-images', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    presignContentImageDownload: (payload: {
      userId?: string;
      path: string;
      expiresInSeconds?: number;
    }) => {
      const params = new URLSearchParams();
      params.set('path', payload.path);
      if (payload.userId) {
        params.set('userId', payload.userId);
      }
      if (typeof payload.expiresInSeconds === 'number') {
        params.set('expiresInSeconds', String(payload.expiresInSeconds));
      }
      return fetchJson(
        `/api/internal/storage/content-images/presign?${params.toString()}`,
        {
          method: 'GET',
        }
      );
    },
    uploadContentImage: async (file: File, userId: string) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('userId', userId);
      return fetchJson('/api/internal/storage/content-images', {
        method: 'POST',
        body: formData,
      });
    },
    listContentImages: (userId: string) =>
      fetchJson(
        `/api/internal/storage/content-images?userId=${encodeURIComponent(userId)}`,
        {
          method: 'GET',
        }
      ),
    deleteContentImage: (filePath: string, userId?: string) =>
      fetchJson('/api/internal/storage/content-images', {
        method: 'DELETE',
        body: JSON.stringify({ filePath, userId }),
      }),
  },
  realtime: {
    subscribe: (
      key: string,
      config: SubscriptionConfig,
      handler: (payload: unknown) => void
    ) => realtimeService.subscribe(key, config, handler),
    unsubscribe: (key: string) => realtimeService.unsubscribe(key),
    unsubscribeAll: () => realtimeService.unsubscribeAll(),
    keys: SubscriptionKeys,
    configs: SubscriptionConfigs,
  },
};

export type BackendClient = typeof backendClient;
