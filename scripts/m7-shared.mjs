#!/usr/bin/env node
import { config as loadEnv } from 'dotenv'
import crypto from 'node:crypto'

loadEnv({ path: '.env.test-stack' })

export const FALLBACK_DATABASE_URL =
  'postgresql://agentif:agentif@172.20.0.1:5432/agentifui'
export const FALLBACK_S3_ENDPOINT = 'http://172.20.0.1:9000'
export const FALLBACK_S3_BUCKET = 'agentifui'
export const FALLBACK_S3_REGION = 'us-east-1'

const DEFAULT_TABLES = [
  'auth_settings',
  'auth_users',
  'auth_accounts',
  'auth_sessions',
  'auth_verifications',
  'auth_local_login_audit_logs',
  'profiles',
  'providers',
  'service_instances',
  'ai_configs',
  'sso_providers',
  'domain_sso_mappings',
  'groups',
  'group_members',
  'group_app_permissions',
  'conversations',
  'messages',
  'app_executions',
  'api_keys',
  'user_identities',
  'profile_external_attributes',
  'user_preferences',
  'api_logs',
  'realtime_outbox_events',
]

export function parseBooleanEnv(value, fallbackValue) {
  if (!value) {
    return fallbackValue
  }

  const normalized = value.trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false
  }

  return fallbackValue
}

export function parsePositiveInt(value, fallbackValue) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallbackValue
  }

  const normalized = Math.floor(parsed)
  if (normalized <= 0) {
    return fallbackValue
  }

  return normalized
}

export function parseCommaList(value, fallbackList) {
  const raw = value?.trim()
  if (!raw) {
    return [...fallbackList]
  }

  const list = raw
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)

  return list.length > 0 ? list : [...fallbackList]
}

export function resolveM7TableList() {
  return parseCommaList(process.env.M7_TABLES, DEFAULT_TABLES)
}

export function resolveM7SourceDatabaseUrl() {
  const value =
    process.env.M7_SOURCE_DATABASE_URL?.trim() ||
    process.env.SUPABASE_DATABASE_URL?.trim() ||
    ''
  if (!value) {
    throw new Error(
      'M7 source database URL is required: set M7_SOURCE_DATABASE_URL or SUPABASE_DATABASE_URL'
    )
  }
  return value
}

export function resolveM7TargetDatabaseUrl() {
  return (
    process.env.M7_TARGET_DATABASE_URL?.trim() ||
    process.env.MIGRATOR_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    FALLBACK_DATABASE_URL
  )
}

export function resolveM7StorageDatabaseUrl() {
  return (
    process.env.M7_STORAGE_DATABASE_URL?.trim() ||
    resolveM7TargetDatabaseUrl()
  )
}

function normalizeDatabaseUrl(value) {
  const parsed = new URL(value)
  parsed.hash = ''
  parsed.pathname = parsed.pathname.replace(/\/$/, '')
  const sortedEntries = [...parsed.searchParams.entries()].sort(([aKey], [bKey]) =>
    aKey.localeCompare(bKey)
  )
  parsed.search = ''
  for (const [key, val] of sortedEntries) {
    parsed.searchParams.append(key, val)
  }
  return parsed.toString()
}

export function isSameDatabaseUrl(sourceDatabaseUrl, targetDatabaseUrl) {
  try {
    return (
      normalizeDatabaseUrl(sourceDatabaseUrl) ===
      normalizeDatabaseUrl(targetDatabaseUrl)
    )
  } catch {
    return sourceDatabaseUrl === targetDatabaseUrl
  }
}

export function assertSourceTargetIsolation({
  sourceDatabaseUrl,
  targetDatabaseUrl,
  allowSameSourceTarget = false,
  context = 'm7',
}) {
  if (!sourceDatabaseUrl?.trim()) {
    throw new Error(`${context}: source database URL is empty`)
  }
  if (!targetDatabaseUrl?.trim()) {
    throw new Error(`${context}: target database URL is empty`)
  }
  if (
    !allowSameSourceTarget &&
    isSameDatabaseUrl(sourceDatabaseUrl, targetDatabaseUrl)
  ) {
    throw new Error(
      `${context}: source and target database URLs are identical; set M7_ALLOW_SAME_SOURCE_TARGET=1 to bypass`
    )
  }
}

export function quoteIdent(value) {
  return `"${String(value).replaceAll('"', '""')}"`
}

export function buildPublicTableRef(tableName) {
  return `${quoteIdent('public')}.${quoteIdent(tableName)}`
}

function resolveS3Config() {
  const endpointRaw =
    process.env.S3_ENDPOINT?.trim() ||
    process.env.M7_STORAGE_S3_ENDPOINT?.trim() ||
    FALLBACK_S3_ENDPOINT
  const bucket =
    process.env.S3_BUCKET?.trim() ||
    process.env.M7_STORAGE_S3_BUCKET?.trim() ||
    FALLBACK_S3_BUCKET
  const region =
    process.env.S3_REGION?.trim() ||
    process.env.M7_STORAGE_S3_REGION?.trim() ||
    FALLBACK_S3_REGION
  const accessKeyId =
    process.env.S3_ACCESS_KEY_ID?.trim() ||
    process.env.MINIO_ROOT_USER?.trim() ||
    'minioadmin'
  const secretAccessKey =
    process.env.S3_SECRET_ACCESS_KEY?.trim() ||
    process.env.MINIO_ROOT_PASSWORD?.trim() ||
    'minioadmin'

  return {
    endpoint: new URL(endpointRaw),
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
  }
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest()
}

function formatAmzDate(date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  }
}

function encodeRfc3986(value) {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  )
}

function encodePath(path) {
  return path
    .split('/')
    .filter(Boolean)
    .map(segment => encodeRfc3986(segment))
    .join('/')
}

function canonicalQueryString(query) {
  const entries = Array.from(query.entries()).sort(
    ([aKey, aValue], [bKey, bValue]) => {
      if (aKey === bKey) {
        return aValue.localeCompare(bValue)
      }
      return aKey.localeCompare(bKey)
    }
  )

  return entries
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&')
}

function buildCanonicalUri(config, key) {
  const keyPath = key ? `/${encodePath(key)}` : ''
  const basePath = config.endpoint.pathname.replace(/\/$/, '')
  return `${basePath}/${config.bucket}${keyPath}`.replace(/\/{2,}/g, '/')
}

function buildObjectUrl(config, key, query) {
  const url = new URL(config.endpoint.toString())
  url.pathname = buildCanonicalUri(config, key)
  if (query) {
    query.forEach((value, name) => {
      url.searchParams.set(name, value)
    })
  }
  return url
}

function buildSigningKey(config, dateStamp) {
  const kDate = hmacSha256(`AWS4${config.secretAccessKey}`, dateStamp)
  const kRegion = hmacSha256(kDate, config.region)
  const kService = hmacSha256(kRegion, 's3')
  return hmacSha256(kService, 'aws4_request')
}

function decodeXmlEntities(value) {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

async function signedRequest({ method, key, query, body, contentType }) {
  const config = resolveS3Config()
  const now = new Date()
  const { amzDate, dateStamp } = formatAmzDate(now)
  const payloadHash = sha256Hex(body || '')
  const requestQuery = query || new URLSearchParams()
  const url = buildObjectUrl(config, key, requestQuery)
  const canonicalUri = buildCanonicalUri(config, key)

  const headers = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  }

  if (contentType) {
    headers['content-type'] = contentType
  }

  const signedHeaderKeys = Object.keys(headers).sort()
  const canonicalHeaders = signedHeaderKeys
    .map(keyName => `${keyName}:${headers[keyName].trim()}\n`)
    .join('')
  const signedHeaders = signedHeaderKeys.join(';')

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQueryString(requestQuery),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n')

  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n')

  const signature = hmacSha256(
    buildSigningKey(config, dateStamp),
    stringToSign
  ).toString('hex')

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`

  return fetch(url.toString(), {
    method,
    headers,
    body,
  })
}

export async function listS3Objects(namespace, prefix = '') {
  const normalizedPrefix = prefix
    ? `${namespace}/${prefix}`.replace(/\/{2,}/g, '/')
    : `${namespace}/`
  const objects = new Set()
  let continuationToken = ''

  while (true) {
    const query = new URLSearchParams({
      'list-type': '2',
      prefix: normalizedPrefix,
      'max-keys': '1000',
    })

    if (continuationToken) {
      query.set('continuation-token', continuationToken)
    }

    const response = await signedRequest({
      method: 'GET',
      query,
    })
    if (!response.ok) {
      const bodyText = await response.text()
      throw new Error(
        `listS3Objects(${namespace}) failed: ${response.status} ${bodyText}`
      )
    }

    const xml = await response.text()
    for (const match of xml.matchAll(/<Key>(.*?)<\/Key>/g)) {
      const key = decodeXmlEntities(match[1] || '')
      if (!key.startsWith(`${namespace}/`)) {
        continue
      }
      objects.add(key.slice(namespace.length + 1))
    }

    const nextTokenMatch = xml.match(
      /<NextContinuationToken>(.*?)<\/NextContinuationToken>/
    )
    continuationToken = nextTokenMatch
      ? decodeXmlEntities(nextTokenMatch[1] || '')
      : ''
    if (!continuationToken) {
      break
    }
  }

  return [...objects].sort()
}

export async function ensureS3BucketExists() {
  const headResponse = await signedRequest({
    method: 'HEAD',
  })
  if (headResponse.ok || headResponse.status === 403) {
    return {
      created: false,
      status: headResponse.status,
    }
  }
  if (headResponse.status !== 404) {
    const bodyText = await headResponse.text().catch(() => '')
    throw new Error(
      `ensureS3BucketExists HEAD failed: ${headResponse.status}${
        bodyText ? ` ${bodyText}` : ''
      }`
    )
  }

  const createResponse = await signedRequest({
    method: 'PUT',
  })
  if (!createResponse.ok) {
    const bodyText = await createResponse.text().catch(() => '')
    throw new Error(
      `ensureS3BucketExists PUT failed: ${createResponse.status}${
        bodyText ? ` ${bodyText}` : ''
      }`
    )
  }

  return {
    created: true,
    status: createResponse.status,
  }
}

export function extractNamespacePathFromUrlLike(value, namespace) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  if (!normalized) {
    return null
  }

  if (normalized.startsWith('user-')) {
    return normalized
  }

  const marker = `${namespace}/`
  const markerIndex = normalized.indexOf(marker)
  if (markerIndex >= 0) {
    return normalized.slice(markerIndex + marker.length).split(/[?#]/)[0]
  }

  try {
    const parsed = new URL(normalized)
    const segments = parsed.pathname
      .split('/')
      .map(segment => decodeURIComponent(segment))
      .filter(Boolean)
    const namespaceIndex = segments.indexOf(namespace)
    if (namespaceIndex >= 0 && namespaceIndex < segments.length - 1) {
      return segments.slice(namespaceIndex + 1).join('/')
    }
  } catch {
    return null
  }

  return null
}

export function toSortedArray(setLike) {
  return [...setLike].sort()
}
