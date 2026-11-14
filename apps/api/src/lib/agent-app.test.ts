/** @jest-environment node */
import { createCipheriv, createHash, randomBytes } from 'node:crypto';

import { readAgentAdmissionLimits, resolveAgentApp } from './agent-app';
import { queryRowsWithPgSystemContext } from './pg-context';

jest.mock('./pg-context', () => ({ queryRowsWithPgSystemContext: jest.fn() }));

const row = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  instance_id: 'test-agent',
  display_name: 'Example Agent',
  base_url: 'https://agent.example',
  config: { backend_type: 'langchain', langchain: { assistant_id: 'agent' } },
  key_value: 'synthetic-service-token',
};

beforeEach(() => {
  jest.mocked(queryRowsWithPgSystemContext).mockReset();
  jest.mocked(queryRowsWithPgSystemContext).mockResolvedValue([{ ...row }]);
});

describe('trusted agent app configuration', () => {
  it('enforces actual actor status and app visibility independently of RLS settings', async () => {
    const app = await resolveAgentApp(row.id, 'actor');
    expect(app.id).toBe(row.id);
    expect(app.apiKey).toBe(row.key_value);
    expect(app.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    const [sql, params] = jest.mocked(queryRowsWithPgSystemContext).mock
      .calls[0];
    expect(sql).toContain("actor.status = 'active'");
    expect(sql).toContain('gap.is_enabled = TRUE');
    expect(sql).toContain('gm.user_id = actor.id');
    expect(sql).toContain('p.is_active = TRUE');
    expect(params).toEqual([row.id, 'actor']);
  });

  it('never resolves an unauthorized or wrong-backend application', async () => {
    jest.mocked(queryRowsWithPgSystemContext).mockResolvedValueOnce([]);
    await expect(resolveAgentApp(row.id, 'other')).rejects.toMatchObject({
      statusCode: 404,
    });
    jest
      .mocked(queryRowsWithPgSystemContext)
      .mockResolvedValueOnce([{ ...row, config: {} }]);
    await expect(resolveAgentApp(row.id, 'actor')).rejects.toMatchObject({
      code: 'AGENT_BACKEND_MISMATCH',
    });
  });

  it('keeps the trusted backend fingerprint stable across same-service key rotation', async () => {
    const first = await resolveAgentApp(row.id, 'actor');
    jest
      .mocked(queryRowsWithPgSystemContext)
      .mockResolvedValueOnce([
        { ...row, key_value: 'synthetic-rotated-token' },
      ]);
    const rotated = await resolveAgentApp(row.id, 'actor');
    expect(rotated.fingerprint).toBe(first.fingerprint);
    expect(rotated.apiKey).not.toBe(first.apiKey);
  });

  it.each([
    { base_url: 'file:///tmp/agent' },
    { base_url: 'https://user:secret@agent.example' },
    { base_url: 'https://agent.example?token=secret' },
    { key_value: null },
    {
      config: {
        backend_type: 'langchain',
        langchain: { assistant_id: '../admin' },
      },
    },
  ])('fails closed on invalid configuration', async patch => {
    jest
      .mocked(queryRowsWithPgSystemContext)
      .mockResolvedValueOnce([{ ...row, ...patch }]);
    await expect(resolveAgentApp(row.id, 'actor')).rejects.toMatchObject({
      statusCode: 503,
      code: 'AGENT_NOT_CONFIGURED',
    });
  });

  it('uses the existing encrypted credential format', async () => {
    const previous = process.env.API_ENCRYPTION_KEY;
    process.env.API_ENCRYPTION_KEY = 'synthetic-master-key';
    try {
      const iv = randomBytes(16);
      const cipher = createCipheriv(
        'aes-256-gcm',
        createHash('sha256').update(process.env.API_ENCRYPTION_KEY).digest(),
        iv
      );
      const encrypted =
        cipher.update(row.key_value, 'utf8', 'hex') + cipher.final('hex');
      jest.mocked(queryRowsWithPgSystemContext).mockResolvedValueOnce([
        {
          ...row,
          key_value: [
            iv.toString('hex'),
            cipher.getAuthTag().toString('hex'),
            encrypted,
          ].join(':'),
        },
      ]);
      expect((await resolveAgentApp(row.id, 'actor')).apiKey).toBe(
        row.key_value
      );
    } finally {
      if (previous === undefined) delete process.env.API_ENCRYPTION_KEY;
      else process.env.API_ENCRYPTION_KEY = previous;
    }
  });

  it('rejects invalid admission settings instead of failing open', () => {
    const previous = process.env.AGENT_MAX_ACTIVE_PER_USER;
    try {
      delete process.env.AGENT_MAX_ACTIVE_PER_USER;
      expect(readAgentAdmissionLimits().userLimit).toBe(1);
      process.env.AGENT_MAX_ACTIVE_PER_USER = '0';
      expect(readAgentAdmissionLimits).toThrow('AGENT_LIMITS_INVALID');
    } finally {
      if (previous === undefined) delete process.env.AGENT_MAX_ACTIVE_PER_USER;
      else process.env.AGENT_MAX_ACTIVE_PER_USER = previous;
    }
  });
});
