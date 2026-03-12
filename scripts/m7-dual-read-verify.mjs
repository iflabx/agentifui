#!/usr/bin/env node
import { Client } from 'pg';

import {
  assertSourceTargetIsolation,
  parseBooleanEnv,
  parsePositiveInt,
  resolveM7SourceDatabaseUrl,
  resolveM7TargetDatabaseUrl,
} from './m7-shared.mjs';

const sourceDatabaseUrl = resolveM7SourceDatabaseUrl();
const targetDatabaseUrl = resolveM7TargetDatabaseUrl();
const allowSameSourceTarget = parseBooleanEnv(
  process.env.M7_ALLOW_SAME_SOURCE_TARGET,
  false
);
const sampleUsers = parsePositiveInt(process.env.M7_DUAL_READ_SAMPLE_USERS, 30);
const rowLimit = parsePositiveInt(process.env.M7_DUAL_READ_ROW_LIMIT, 50);
const sampleStrategyRaw =
  process.env.M7_DUAL_READ_SAMPLE_STRATEGY?.trim().toLowerCase() || 'sample';
const sampleStrategy = sampleStrategyRaw === 'all' ? 'all' : 'sample';
const requireFullCoverage = parseBooleanEnv(
  process.env.M7_DUAL_READ_REQUIRE_FULL_COVERAGE,
  false
);
const minCoverageRatioRaw = Number(process.env.M7_DUAL_READ_MIN_COVERAGE || 0);
const minCoverageRatio = Number.isFinite(minCoverageRatioRaw)
  ? Math.min(1, Math.max(0, minCoverageRatioRaw))
  : 0;

const userScopedPaths = [
  {
    id: 'profile-by-id',
    table: 'profiles',
    sql: `
      SELECT
        COUNT(*)::bigint AS c,
        COALESCE(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.id::text)), md5('')) AS checksum
      FROM (
        SELECT *
        FROM profiles
        WHERE id = $1::uuid
      ) t
    `,
    params: userId => [userId],
  },
  {
    id: 'conversations-by-user',
    table: 'conversations',
    sql: `
      SELECT
        COUNT(*)::bigint AS c,
        COALESCE(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.updated_at DESC, t.id::text)), md5('')) AS checksum
      FROM (
        SELECT *
        FROM conversations
        WHERE user_id = $1::uuid
        ORDER BY updated_at DESC NULLS LAST, id ASC
        LIMIT $2
      ) t
    `,
    params: userId => [userId, rowLimit],
  },
  {
    id: 'messages-by-user',
    table: 'messages',
    sql: `
      SELECT
        COUNT(*)::bigint AS c,
        COALESCE(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.created_at DESC, t.id::text)), md5('')) AS checksum
      FROM (
        SELECT *
        FROM messages
        WHERE user_id = $1::uuid
        ORDER BY created_at DESC, id ASC
        LIMIT $2
      ) t
    `,
    params: userId => [userId, rowLimit],
  },
  {
    id: 'app-executions-by-user',
    table: 'app_executions',
    sql: `
      SELECT
        COUNT(*)::bigint AS c,
        COALESCE(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.created_at DESC, t.id::text)), md5('')) AS checksum
      FROM (
        SELECT *
        FROM app_executions
        WHERE user_id = $1::uuid
        ORDER BY created_at DESC NULLS LAST, id ASC
        LIMIT $2
      ) t
    `,
    params: userId => [userId, rowLimit],
  },
  {
    id: 'user-identities-by-user',
    table: 'user_identities',
    sql: `
      SELECT
        COUNT(*)::bigint AS c,
        COALESCE(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.id::text)), md5('')) AS checksum
      FROM (
        SELECT *
        FROM user_identities
        WHERE user_id = $1::uuid
        ORDER BY id ASC
      ) t
    `,
    params: userId => [userId],
  },
];

const globalPaths = [
  {
    id: 'providers-global',
    table: 'providers',
    sql: `
      SELECT
        COUNT(*)::bigint AS c,
        COALESCE(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.id::text)), md5('')) AS checksum
      FROM (
        SELECT *
        FROM providers
        ORDER BY id ASC
      ) t
    `,
    params: () => [],
  },
  {
    id: 'service-instances-global',
    table: 'service_instances',
    sql: `
      SELECT
        COUNT(*)::bigint AS c,
        COALESCE(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.id::text)), md5('')) AS checksum
      FROM (
        SELECT *
        FROM service_instances
        ORDER BY id ASC
      ) t
    `,
    params: () => [],
  },
  {
    id: 'sso-providers-global',
    table: 'sso_providers',
    sql: `
      SELECT
        COUNT(*)::bigint AS c,
        COALESCE(md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY t.id::text)), md5('')) AS checksum
      FROM (
        SELECT *
        FROM sso_providers
        ORDER BY id ASC
      ) t
    `,
    params: () => [],
  },
];

async function loadTableSet(client) {
  const { rows } = await client.query(
    `
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
    `
  );
  return new Set(rows.map(row => row.table_name));
}

async function queryReadHash(client, sql, params) {
  const { rows } = await client.query(sql, params);
  return {
    count: Number(rows[0]?.c || 0),
    checksum: rows[0]?.checksum || null,
  };
}

async function run() {
  assertSourceTargetIsolation({
    sourceDatabaseUrl,
    targetDatabaseUrl,
    allowSameSourceTarget,
    context: 'm7-dual-read-verify',
  });

  const sourceClient = new Client({ connectionString: sourceDatabaseUrl });
  const targetClient = new Client({ connectionString: targetDatabaseUrl });
  await sourceClient.connect();
  await targetClient.connect();

  try {
    const totalUsersResult = await sourceClient.query(`
      SELECT COUNT(*)::bigint AS c
      FROM profiles
    `);
    const totalUsers = Number(totalUsersResult.rows[0]?.c || 0);

    const [sourceTables, targetTables] = await Promise.all([
      loadTableSet(sourceClient),
      loadTableSet(targetClient),
    ]);
    const sharedTableNames = new Set(
      [...sourceTables].filter(tableName => targetTables.has(tableName))
    );

    const activeUserPaths = userScopedPaths.filter(path =>
      sharedTableNames.has(path.table)
    );
    const activeGlobalPaths = globalPaths.filter(path =>
      sharedTableNames.has(path.table)
    );
    const skippedPaths = [
      ...userScopedPaths.filter(path => !sharedTableNames.has(path.table)),
      ...globalPaths.filter(path => !sharedTableNames.has(path.table)),
    ].map(path => ({
      id: path.id,
      table: path.table,
      reason: 'table_not_shared_between_source_target',
    }));

    const sampleUserRows =
      sampleStrategy === 'all'
        ? await sourceClient.query(`
            SELECT id::text AS id
            FROM profiles
            ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
          `)
        : await sourceClient.query(
            `
              SELECT id::text AS id
              FROM profiles
              ORDER BY updated_at DESC NULLS LAST, created_at DESC NULLS LAST
              LIMIT $1
            `,
            [sampleUsers]
          );
    const sampledUserIds = sampleUserRows.rows.map(row => row.id);
    const coverageRatio =
      totalUsers === 0
        ? 1
        : Number((sampledUserIds.length / totalUsers).toFixed(6));

    const pathSummary = [];
    const mismatches = [];

    for (const path of activeUserPaths) {
      let comparedUsers = 0;
      let mismatchCount = 0;
      for (const userId of sampledUserIds) {
        const [sourceResult, targetResult] = await Promise.all([
          queryReadHash(sourceClient, path.sql, path.params(userId)),
          queryReadHash(targetClient, path.sql, path.params(userId)),
        ]);
        comparedUsers += 1;

        const matched =
          sourceResult.count === targetResult.count &&
          sourceResult.checksum === targetResult.checksum;
        if (!matched) {
          mismatchCount += 1;
          if (mismatches.length < 100) {
            mismatches.push({
              pathId: path.id,
              scope: 'user',
              userId,
              sourceCount: sourceResult.count,
              targetCount: targetResult.count,
              sourceChecksum: sourceResult.checksum,
              targetChecksum: targetResult.checksum,
            });
          }
        }
      }

      pathSummary.push({
        pathId: path.id,
        scope: 'user',
        table: path.table,
        comparedUsers,
        mismatchCount,
      });
    }

    for (const path of activeGlobalPaths) {
      const [sourceResult, targetResult] = await Promise.all([
        queryReadHash(sourceClient, path.sql, path.params()),
        queryReadHash(targetClient, path.sql, path.params()),
      ]);
      const matched =
        sourceResult.count === targetResult.count &&
        sourceResult.checksum === targetResult.checksum;
      if (!matched && mismatches.length < 100) {
        mismatches.push({
          pathId: path.id,
          scope: 'global',
          sourceCount: sourceResult.count,
          targetCount: targetResult.count,
          sourceChecksum: sourceResult.checksum,
          targetChecksum: targetResult.checksum,
        });
      }

      pathSummary.push({
        pathId: path.id,
        scope: 'global',
        table: path.table,
        comparedUsers: 0,
        mismatchCount: matched ? 0 : 1,
      });
    }

    const checks = {
      sampledUsersLoaded: totalUsers === 0 ? true : sampledUserIds.length > 0,
      coverageSufficient:
        totalUsers === 0
          ? true
          : requireFullCoverage
            ? sampledUserIds.length === totalUsers
            : coverageRatio >= minCoverageRatio,
      userPathsMatch: pathSummary
        .filter(item => item.scope === 'user')
        .every(item => item.mismatchCount === 0),
      globalPathsMatch: pathSummary
        .filter(item => item.scope === 'global')
        .every(item => item.mismatchCount === 0),
    };

    const payload = {
      ok: Object.values(checks).every(Boolean),
      sourceDatabaseUrl,
      targetDatabaseUrl,
      checks,
      config: {
        sampleUsers,
        rowLimit,
        sampleStrategy,
        requireFullCoverage,
        minCoverageRatio,
      },
      scope: {
        totalUsers,
        sampledUsers: sampledUserIds.length,
        coverageRatio,
        sampledUserIds: sampledUserIds.slice(0, 20),
      },
      paths: pathSummary,
      skippedPaths,
      mismatchSample: mismatches.slice(0, 20),
    };

    console.log(JSON.stringify(payload, null, 2));
    if (!payload.ok) {
      process.exitCode = 1;
    }
  } finally {
    await sourceClient.end().catch(() => {});
    await targetClient.end().catch(() => {});
  }
}

run().catch(error => {
  console.error(
    `[m7-dual-read-verify] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
