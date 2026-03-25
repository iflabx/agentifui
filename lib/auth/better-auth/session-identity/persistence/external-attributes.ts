import {
  getProfileExternalAttributes,
  upsertProfileExternalAttributes,
} from '@lib/db/user-identities';

import {
  getExternalAttributesSyncIntervalMs,
  shouldUseIntervalExternalAttributesSync,
} from '../constants';
import { buildExternalAttributesPayload } from '../helpers';
import type { SessionUser } from '../types';

export async function syncExternalAttributes(
  userId: string,
  sessionUser: SessionUser
): Promise<void> {
  const payload = buildExternalAttributesPayload(userId, sessionUser);
  if (!payload) {
    return;
  }

  const existingAttributes = await getProfileExternalAttributes(userId, {
    actorUserId: userId,
  });
  if (!existingAttributes.success) {
    console.warn(
      '[SessionIdentity] failed to load existing external attributes:',
      existingAttributes.error
    );
  } else if (existingAttributes.data) {
    const normalizedIssuer = payload.source_issuer.trim().toLowerCase();
    const sameSource =
      existingAttributes.data.source_issuer.trim().toLowerCase() ===
        normalizedIssuer &&
      existingAttributes.data.source_provider.trim() ===
        payload.source_provider.trim();

    if (sameSource) {
      const syncedAtMs = Date.parse(existingAttributes.data.synced_at);
      const syncIntervalMs = getExternalAttributesSyncIntervalMs();
      const isFresh =
        Number.isFinite(syncedAtMs) && Date.now() - syncedAtMs < syncIntervalMs;
      if (shouldUseIntervalExternalAttributesSync() && isFresh) {
        return;
      }
    }
  }

  const upsert = await upsertProfileExternalAttributes(payload, {
    actorUserId: userId,
  });
  if (!upsert.success) {
    console.warn(
      '[SessionIdentity] failed to sync external profile attributes:',
      upsert.error
    );
  }
}
