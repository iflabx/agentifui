import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import Module, { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import typescript from 'typescript';

const loadModule = createRequire(import.meta.url);

const databaseName = new URL(process.env.DATABASE_URL).pathname;
if (
  !databaseName.startsWith('/gov_verify_') &&
  databaseName !== '/agentifui_test'
) {
  throw new Error('A dedicated gov_verify_ database is required');
}
const root = fileURLToPath(new URL('../../../', import.meta.url));
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  return originalResolve.call(
    this,
    request.startsWith('@lib/')
      ? path.join(root, 'lib', request.slice(5))
      : request,
    ...args
  );
};
loadModule.extensions['.ts'] = (module, filename) => {
  const result = typescript.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: filename,
  });
  module._compile(result.outputText, filename);
};

async function main() {
  const { betterAuth } = await import('better-auth');
  const { createBetterAuthSecondaryStorage } = loadModule(
    path.join(root, 'lib/auth/better-auth/secondary-storage.ts')
  );
  const { getAuthSessionConfig } = loadModule(
    path.join(root, 'lib/auth/better-auth/server/config.ts')
  );
  const { redisManager } = loadModule(path.join(root, 'lib/infra/redis'));
  const { getPgPool } = loadModule(path.join(root, 'lib/server/pg/pool.ts'));
  const { cleanupRevokedLoginSessions } = loadModule(
    path.join(root, 'apps/api/src/lib/session-revocation.ts')
  );
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
  });
  const userId = randomUUID();
  const secondary = createBetterAuthSecondaryStorage();
  const options = {
    database: pool,
    baseURL: 'https://auth.example.invalid',
    secret: 'synthetic-session-verification-secret-123456789',
    session: getAuthSessionConfig(),
    secondaryStorage: secondary,
    user: {
      modelName: 'auth_users',
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },
    advanced: { database: { generateId: 'uuid' } },
    logger: { disabled: true },
    rateLimit: { enabled: false },
  };
  const first = await betterAuth(options).$context;
  const second = await betterAuth({
    ...options,
    secondaryStorage: createBetterAuthSecondaryStorage(),
  }).$context;
  const keys = [];
  try {
    await pool.query('INSERT INTO auth_users(id,name,email) VALUES($1,$2,$3)', [
      userId,
      'Synthetic session test',
      `${userId}@example.invalid`,
    ]);
    const old = await first.internalAdapter.createSession(userId);
    keys.push(
      old.token,
      `active-sessions-${userId}`,
      `revoked-sessions-before-${userId}`
    );
    const stale = await secondary.get(old.token);
    assert.ok(stale);
    assert.ok(await second.internalAdapter.findSession(old.token));
    await pool.query('DELETE FROM auth_sessions WHERE token=$1', [old.token]);
    assert.ok(await redisManager.get(`better-auth:secondary:${old.token}`));
    assert.equal(await first.internalAdapter.findSession(old.token), null);
    assert.equal(await second.internalAdapter.findSession(old.token), null);
    await secondary.set(old.token, stale, 120);
    await first.internalAdapter.updateSession(old.token, {
      expiresAt: new Date(Date.now() + 3600000),
    });
    assert.equal(
      (
        await pool.query('SELECT id FROM auth_sessions WHERE token=$1', [
          old.token,
        ])
      ).rows.length,
      0
    );
    assert.equal(await second.internalAdapter.findSession(old.token), null);
    const fresh = await first.internalAdapter.createSession(userId);
    keys.push(fresh.token);
    assert.equal(
      await cleanupRevokedLoginSessions([
        { token: old.token, user_id: userId },
      ]),
      'completed'
    );
    assert.ok(await second.internalAdapter.findSession(fresh.token));
    assert.equal(await secondary.get(old.token), null);
    const index = JSON.parse(await secondary.get(`active-sessions-${userId}`));
    assert.ok(index.some(item => item.token === fresh.token));
    assert.ok(!index.some(item => item.token === old.token));
    assert.equal(
      await secondary.get(`revoked-sessions-before-${userId}`),
      null
    );
    console.log(
      'PASS real Better Auth: two adapter instances reject stale Redis sessions; refresh never reinserts; targeted cleanup preserves new login'
    );
  } finally {
    await pool.query('DELETE FROM auth_users WHERE id=$1', [userId]);
    for (const key of keys) await secondary.delete(key);
    await redisManager.quit();
    await getPgPool().end();
    await pool.end();
  }
}
main().catch(error => {
  console.error(
    'Real Better Auth verification failed:',
    error.code || error.name
  );
  process.exitCode = 1;
});
