#!/usr/bin/env node
import { Client } from 'pg';

import {
  extractNamespacePathFromUrlLike,
  listS3Objects,
  parseBooleanEnv,
  parsePositiveInt,
  resolveM7StorageDatabaseUrl,
  toSortedArray,
} from './m7-shared.mjs';

const databaseUrl = resolveM7StorageDatabaseUrl();
const maxUserCount = parsePositiveInt(process.env.M7_STORAGE_MAX_USERS, 2000);
const maxMissingRate = Number(process.env.M7_STORAGE_MAX_MISSING_RATE || 0.001);
const maxOrphanRate = Number(process.env.M7_STORAGE_MAX_ORPHAN_RATE || 0.001);
const scanStrategyRaw =
  process.env.M7_STORAGE_SCAN_STRATEGY?.trim().toLowerCase() || 'sample';
const scanStrategy = scanStrategyRaw === 'all' ? 'all' : 'sample';
const requireFullCoverage = parseBooleanEnv(
  process.env.M7_STORAGE_REQUIRE_FULL_COVERAGE,
  false
);
const minCoverageRatioRaw = Number(process.env.M7_STORAGE_MIN_COVERAGE || 0);
const minCoverageRatio = Number.isFinite(minCoverageRatioRaw)
  ? Math.min(1, Math.max(0, minCoverageRatioRaw))
  : 0;

function normalizeRate(value) {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function parseContentImagePaths(raw) {
  if (typeof raw !== 'string' || !raw) {
    return [];
  }

  const paths = new Set();
  const regex = /content-images\/([A-Za-z0-9\-._~%/]+)/g;
  for (const match of raw.matchAll(regex)) {
    const matchedPath = (match[1] || '')
      .replace(/[),.;!?]+$/, '')
      .replaceAll('%2F', '/');
    if (matchedPath) {
      paths.add(matchedPath);
    }
  }
  return [...paths];
}

function toRate(numerator, denominator) {
  if (!Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return normalizeRate(numerator / denominator);
}

function calculateNamespaceStats({
  namespace,
  referencedPaths,
  existingPaths,
  maxMissingRateThreshold,
  maxOrphanRateThreshold,
}) {
  const missing = [];
  for (const path of referencedPaths) {
    if (!existingPaths.has(path)) {
      missing.push(path);
    }
  }

  const orphan = [];
  for (const path of existingPaths) {
    if (!referencedPaths.has(path)) {
      orphan.push(path);
    }
  }

  const missingRate = toRate(missing.length, referencedPaths.size);
  const orphanRate = toRate(orphan.length, existingPaths.size);
  const checks = {
    missingRateWithinThreshold: missingRate <= maxMissingRateThreshold,
    orphanRateWithinThreshold: orphanRate <= maxOrphanRateThreshold,
  };

  return {
    namespace,
    checks,
    referencedCount: referencedPaths.size,
    existingCount: existingPaths.size,
    missingCount: missing.length,
    orphanCount: orphan.length,
    missingRate,
    orphanRate,
    missingSample: missing.slice(0, 20),
    orphanSample: orphan.slice(0, 20),
  };
}

async function run() {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const totalUsersResult = await client.query(`
      SELECT COUNT(*)::bigint AS c
      FROM profiles
    `);
    const totalUsers = Number(totalUsersResult.rows[0]?.c || 0);

    const userRows =
      scanStrategy === 'all'
        ? await client.query(`
            SELECT id::text AS id
            FROM profiles
            ORDER BY created_at ASC
          `)
        : await client.query(
            `
              SELECT id::text AS id
              FROM profiles
              ORDER BY created_at ASC
              LIMIT $1
            `,
            [maxUserCount]
          );
    const userIds = userRows.rows.map(row => row.id);
    const coverageRatio =
      totalUsers === 0 ? 1 : Number((userIds.length / totalUsers).toFixed(6));

    const avatarRows = await client.query(`
      SELECT avatar_url
      FROM profiles
      WHERE avatar_url IS NOT NULL
        AND avatar_url <> ''
    `);

    const messageRows = await client.query(`
      SELECT content, metadata::text AS metadata_text
      FROM messages
      WHERE content ILIKE '%content-images/%'
         OR metadata::text ILIKE '%content-images/%'
    `);

    const referencedAvatarPaths = new Set();
    for (const row of avatarRows.rows) {
      const path = extractNamespacePathFromUrlLike(row.avatar_url, 'avatars');
      if (path) {
        referencedAvatarPaths.add(path);
      }
    }

    const referencedContentPaths = new Set();
    for (const row of messageRows.rows) {
      for (const path of parseContentImagePaths(row.content || '')) {
        referencedContentPaths.add(path);
      }
      for (const path of parseContentImagePaths(row.metadata_text || '')) {
        referencedContentPaths.add(path);
      }
    }

    const scopedAvatarObjects = new Set();
    const scopedContentObjects = new Set();
    for (const userId of userIds) {
      const userPrefix = `user-${userId}/`;
      const [avatarPaths, contentPaths] = await Promise.all([
        listS3Objects('avatars', userPrefix),
        listS3Objects('content-images', userPrefix),
      ]);
      for (const path of avatarPaths) {
        scopedAvatarObjects.add(path);
      }
      for (const path of contentPaths) {
        scopedContentObjects.add(path);
      }
    }

    const avatarStats = calculateNamespaceStats({
      namespace: 'avatars',
      referencedPaths: referencedAvatarPaths,
      existingPaths: scopedAvatarObjects,
      maxMissingRateThreshold: maxMissingRate,
      maxOrphanRateThreshold: maxOrphanRate,
    });
    const contentStats = calculateNamespaceStats({
      namespace: 'content-images',
      referencedPaths: referencedContentPaths,
      existingPaths: scopedContentObjects,
      maxMissingRateThreshold: maxMissingRate,
      maxOrphanRateThreshold: maxOrphanRate,
    });

    const checks = {
      coverageSufficient:
        totalUsers === 0
          ? true
          : requireFullCoverage
            ? userIds.length === totalUsers
            : coverageRatio >= minCoverageRatio,
      avatarMissingRateWithinThreshold:
        avatarStats.checks.missingRateWithinThreshold,
      avatarOrphanRateWithinThreshold:
        avatarStats.checks.orphanRateWithinThreshold,
      contentMissingRateWithinThreshold:
        contentStats.checks.missingRateWithinThreshold,
      contentOrphanRateWithinThreshold:
        contentStats.checks.orphanRateWithinThreshold,
    };

    const ok = Object.values(checks).every(Boolean);
    const payload = {
      ok,
      databaseUrl,
      checks,
      thresholds: {
        maxMissingRate,
        maxOrphanRate,
      },
      config: {
        scanStrategy,
        maxUserCount,
        requireFullCoverage,
        minCoverageRatio,
      },
      scope: {
        totalUsers,
        scopedUsers: userIds.length,
        coverageRatio,
        userSample: userIds.slice(0, 20),
      },
      namespaces: [avatarStats, contentStats],
      referencedSamples: {
        avatars: toSortedArray(referencedAvatarPaths).slice(0, 20),
        contentImages: toSortedArray(referencedContentPaths).slice(0, 20),
      },
    };

    console.log(JSON.stringify(payload, null, 2));
    if (!ok) {
      process.exitCode = 1;
    }
  } finally {
    await client.end().catch(() => {});
  }
}

run().catch(error => {
  console.error(
    `[m7-storage-reconcile-verify] ${error instanceof Error ? error.message : String(error)}`
  );
  process.exitCode = 1;
});
