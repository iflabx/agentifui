#!/usr/bin/env node
import { Client } from 'pg'
import {
  assertSourceTargetIsolation,
  buildPublicTableRef,
  parseBooleanEnv,
  quoteIdent,
  resolveM7SourceDatabaseUrl,
  resolveM7TableList,
  resolveM7TargetDatabaseUrl,
} from './m7-shared.mjs'

const sourceDatabaseUrl = resolveM7SourceDatabaseUrl()
const targetDatabaseUrl = resolveM7TargetDatabaseUrl()
const allowSameSourceTarget = parseBooleanEnv(
  process.env.M7_ALLOW_SAME_SOURCE_TARGET,
  false
)
const tableNames = resolveM7TableList()
const bucketTables = ['conversations', 'messages', 'app_executions']

function createBucketMap(rows) {
  const map = new Map()
  for (const row of rows) {
    map.set(row.user_id, Number(row.c))
  }
  return map
}

function compareBucketMaps(sourceMap, targetMap) {
  const mismatches = []
  const keys = new Set([...sourceMap.keys(), ...targetMap.keys()])
  for (const key of [...keys].sort()) {
    const sourceCount = sourceMap.get(key) || 0
    const targetCount = targetMap.get(key) || 0
    if (sourceCount === targetCount) {
      continue
    }
    mismatches.push({
      userId: key,
      sourceCount,
      targetCount,
      diff: targetCount - sourceCount,
    })
  }
  return mismatches
}

async function getPrimaryKeyColumns(client, tableName) {
  const { rows } = await client.query(
    `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
      WHERE tc.table_schema = 'public'
        AND tc.table_name = $1
        AND tc.constraint_type = 'PRIMARY KEY'
      ORDER BY kcu.ordinal_position
    `,
    [tableName]
  )
  return rows.map(row => row.column_name)
}

async function getTableCount(client, tableName) {
  const tableRef = buildPublicTableRef(tableName)
  const { rows } = await client.query(
    `SELECT COUNT(*)::bigint AS c FROM ${tableRef}`
  )
  return Number(rows[0]?.c || 0)
}

async function getTableChecksum(client, tableName, primaryKeyColumns) {
  const tableRef = buildPublicTableRef(tableName)
  const orderExpression = `concat_ws('|', ${primaryKeyColumns
    .map(column => `COALESCE(t.${quoteIdent(column)}::text, '')`)
    .join(', ')})`
  const { rows } = await client.query(
    `
      SELECT COALESCE(
        md5(string_agg(md5(row_to_json(t)::text), '' ORDER BY ${orderExpression})),
        md5('')
      ) AS checksum
      FROM ${tableRef} t
    `
  )
  return rows[0]?.checksum || null
}

async function getUserBuckets(client, tableName) {
  const tableRef = buildPublicTableRef(tableName)
  const { rows } = await client.query(
    `
      SELECT user_id::text AS user_id, COUNT(*)::bigint AS c
      FROM ${tableRef}
      GROUP BY user_id
      ORDER BY user_id
    `
  )
  return createBucketMap(rows)
}

async function getConstraintMetrics(client) {
  const orphanMessagesResult = await client.query(`
    SELECT COUNT(*)::bigint AS c
    FROM messages m
    LEFT JOIN conversations c ON c.id = m.conversation_id
    WHERE c.id IS NULL
  `)

  const invalidQuotaResult = await client.query(`
    SELECT COUNT(*)::bigint AS c
    FROM group_app_permissions
    WHERE usage_quota IS NOT NULL
      AND used_count > usage_quota
  `)

  const orphanConversationOwnersResult = await client.query(`
    SELECT COUNT(*)::bigint AS c
    FROM conversations c
    LEFT JOIN profiles p ON p.id = c.user_id
    WHERE p.id IS NULL
  `)

  return {
    orphanMessages: Number(orphanMessagesResult.rows[0]?.c || 0),
    invalidQuotaRows: Number(invalidQuotaResult.rows[0]?.c || 0),
    orphanConversationOwners: Number(orphanConversationOwnersResult.rows[0]?.c || 0),
  }
}

async function run() {
  assertSourceTargetIsolation({
    sourceDatabaseUrl,
    targetDatabaseUrl,
    allowSameSourceTarget,
    context: 'm7-reconcile-verify',
  })

  const sourceClient = new Client({ connectionString: sourceDatabaseUrl })
  const targetClient = new Client({ connectionString: targetDatabaseUrl })
  await sourceClient.connect()
  await targetClient.connect()

  const tableChecks = []
  const bucketChecks = []

  try {
    for (const tableName of tableNames) {
      const primaryKeyColumns = await getPrimaryKeyColumns(targetClient, tableName)
      if (primaryKeyColumns.length === 0) {
        throw new Error(`table ${tableName} has no primary key in target database`)
      }

      const [sourceCount, targetCount, sourceChecksum, targetChecksum] =
        await Promise.all([
          getTableCount(sourceClient, tableName),
          getTableCount(targetClient, tableName),
          getTableChecksum(sourceClient, tableName, primaryKeyColumns),
          getTableChecksum(targetClient, tableName, primaryKeyColumns),
        ])

      tableChecks.push({
        table: tableName,
        primaryKeyColumns,
        rowCountMatch: sourceCount === targetCount,
        checksumMatch: sourceChecksum === targetChecksum,
        sourceCount,
        targetCount,
        sourceChecksum,
        targetChecksum,
      })
    }

    for (const tableName of bucketTables) {
      const [sourceBuckets, targetBuckets] = await Promise.all([
        getUserBuckets(sourceClient, tableName),
        getUserBuckets(targetClient, tableName),
      ])
      const mismatches = compareBucketMaps(sourceBuckets, targetBuckets)
      bucketChecks.push({
        table: tableName,
        bucketMatch: mismatches.length === 0,
        sourceBucketCount: sourceBuckets.size,
        targetBucketCount: targetBuckets.size,
        mismatchCount: mismatches.length,
        mismatchSample: mismatches.slice(0, 20),
      })
    }

    const constraintMetrics = await getConstraintMetrics(targetClient)
    const checks = {
      rowCountsMatch: tableChecks.every(item => item.rowCountMatch),
      checksumsMatch: tableChecks.every(item => item.checksumMatch),
      userBucketsMatch: bucketChecks.every(item => item.bucketMatch),
      constraintsClean:
        constraintMetrics.orphanMessages === 0 &&
        constraintMetrics.invalidQuotaRows === 0 &&
        constraintMetrics.orphanConversationOwners === 0,
    }

    const ok = Object.values(checks).every(Boolean)
    const payload = {
      ok,
      sourceDatabaseUrl,
      targetDatabaseUrl,
      checks,
      tableChecks,
      bucketChecks,
      constraintMetrics,
    }

    console.log(JSON.stringify(payload, null, 2))
    if (!ok) {
      process.exitCode = 1
    }
  } finally {
    await sourceClient.end().catch(() => {})
    await targetClient.end().catch(() => {})
  }
}

run().catch(error => {
  console.error(
    `[m7-reconcile-verify] ${error instanceof Error ? error.message : String(error)}`
  )
  process.exitCode = 1
})
