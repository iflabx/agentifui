/** @jest-environment node */
import type { PoolClient } from 'pg';

import {
  type AgentSubmission,
  requireResumeAuthorization,
  submissionHash,
} from './agent-submissions';

const userId = '10000000-0000-4000-8000-000000000001';
const appId = '20000000-0000-4000-8000-000000000001';
const rootId = '30000000-0000-4000-8000-000000000001';
const version = '40000000-0000-4000-8000-000000000001';
let task: AgentSubmission;
let target: Record<string, unknown> | null;
let originalPermission: boolean;
let query: jest.Mock;

beforeEach(() => {
  task = {
    user_id: userId,
    service_instance_id: appId,
    run_id: rootId,
    backend_type: 'langchain',
    quota_state: 'counted',
    quota_permission_id: 'original-permission',
    credential_version: version,
    target_fingerprint: submissionHash([
      appId,
      'https://example.invalid',
      'confirmation',
    ]),
  } as AgentSubmission;
  target = {
    visibility: 'group_only',
    config: {
      backend_type: 'langchain',
      langchain: { assistant_id: 'confirmation', human_input: true },
    },
    base_url: 'https://example.invalid',
    credential_version: version,
  };
  originalPermission = true;
  query = jest.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes('SELECT * FROM agent_submissions'))
      return { rows: [task] };
    if (sql.includes('SELECT si.visibility'))
      return { rows: target ? [target] : [] };
    if (sql.includes('SELECT gap.id')) {
      expect(params).toEqual(['original-permission', appId, userId]);
      return {
        rows: originalPermission ? [{ id: 'original-permission' }] : [],
      };
    }
    throw new Error(`Unexpected resume authorization query: ${sql}`);
  });
});

function authorize() {
  return requireResumeAuthorization(
    { query } as unknown as PoolClient,
    rootId,
    userId,
    appId
  );
}

it('reuses pinned authorization without counting computation slots or charging quota', async () => {
  await authorize();
  expect(query).toHaveBeenCalledTimes(3);
  expect(query.mock.calls[1][0]).toContain("actor.status = 'active'");
  expect(query.mock.calls[1][0]).toContain('p.is_active = TRUE');
  expect(query.mock.calls[1][0]).toContain('FOR SHARE OF si, p, actor');
  expect(query.mock.calls[2][0]).toContain('FOR SHARE OF gap, gm');
});

it.each([
  'credential',
  'target',
  'backend',
  'disabled',
  'original-group',
  'actor-or-provider',
  'root-quota',
])('rejects a changed %s at the final authorization boundary', async change => {
  let code = 'AGENT_CONFIG_CHANGED';
  if (change === 'credential') target!.credential_version = 'new-version';
  if (change === 'target') target!.base_url = 'https://changed.invalid';
  if (change === 'backend') {
    target!.config = { backend_type: 'dify' };
    code = 'AGENT_BACKEND_MISMATCH';
  }
  if (change === 'disabled') {
    target!.config = {
      backend_type: 'langchain',
      langchain: { assistant_id: 'confirmation', human_input: false },
    };
    code = 'AGENT_INTERACTION_NOT_ENABLED';
  }
  if (change === 'original-group') {
    originalPermission = false;
    code = 'AGENT_APP_FORBIDDEN';
  }
  if (change === 'actor-or-provider') {
    target = null;
    code = 'AGENT_APP_FORBIDDEN';
  }
  if (change === 'root-quota') {
    task.quota_state = 'released';
    code = 'AGENT_ROOT_NOT_ACCEPTED';
  }
  await expect(authorize()).rejects.toMatchObject({ code });
});
