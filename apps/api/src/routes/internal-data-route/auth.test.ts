/** @jest-environment node */
import type { FastifyRequest } from 'fastify';

import type { ApiRuntimeConfig } from '../../config';
import { resolveProfileStatusFromSession } from '../../lib/session-identity';
import { ensureActionPermission } from './auth';
import * as actionTypes from './types';

jest.mock('../../lib/session-identity', () => ({
  resolveProfileStatusFromSession: jest.fn(),
}));
jest.mock('../../lib/pg-context', () => ({
  queryRowsWithPgSystemContext: jest.fn(),
}));

const request = {} as FastifyRequest;
const config = {} as ApiRuntimeConfig;
const action = 'conversations.syncGeneratedTitleIfPlaceholder';

describe('internal action authorization', () => {
  it('classifies every implemented action exactly once', () => {
    const actions = Object.entries(actionTypes)
      .filter(
        ([name]) => name.startsWith('LOCAL_') && name.endsWith('_ACTIONS')
      )
      .flatMap(([, values]) => [...(values as Set<string>)]);
    for (const implemented of actions) {
      const classifications =
        Number(actionTypes.AUTH_ACTIONS.has(implemented)) +
        Number(actionTypes.ADMIN_ACTIONS.has(implemented));
      expect({ action: implemented, classifications }).toEqual({
        action: implemented,
        classifications: 1,
      });
    }
  });

  it('rejects unauthenticated generated-title synchronization', async () => {
    jest
      .mocked(resolveProfileStatusFromSession)
      .mockResolvedValueOnce({ kind: 'unauthorized' });
    const result = await ensureActionPermission(request, config, action, {
      userId: 'victim',
    });
    expect(result.error?.statusCode).toBe(401);
  });

  it('rejects another user but permits the authenticated owner', async () => {
    jest.mocked(resolveProfileStatusFromSession).mockResolvedValue({
      kind: 'ok',
      identity: {
        userId: 'actor',
        authUserId: 'actor',
        role: 'user',
        status: 'active',
      },
    });
    expect(
      (
        await ensureActionPermission(request, config, action, {
          userId: 'victim',
        })
      ).error?.statusCode
    ).toBe(403);
    expect(
      await ensureActionPermission(request, config, action, { userId: 'actor' })
    ).toEqual({ error: null, actorUserId: 'actor' });
  });

  it('denies unclassified actions instead of allowing them through', async () => {
    const result = await ensureActionPermission(
      request,
      config,
      'new.unclassifiedAction',
      {}
    );
    expect(result.error?.statusCode).toBe(403);
    expect(resolveProfileStatusFromSession).not.toHaveBeenCalled();
  });
});
