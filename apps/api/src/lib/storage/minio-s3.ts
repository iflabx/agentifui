import crypto from 'node:crypto';

type S3Config = {
  endpoint: URL;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

type SignedMethod = 'GET' | 'PUT' | 'DELETE' | 'HEAD';

type PresignInput = {
  method: 'GET' | 'PUT';
  key: string;
  expiresInSeconds?: number;
  query?: URLSearchParams;
};

export type HeadObjectResult = {
  exists: boolean;
  status: number;
  contentType: string | null;
  contentLength: number | null;
  eTag: string | null;
  lastModified: string | null;
};

const DEFAULT_PRESIGN_EXPIRES_SECONDS = 5 * 60;
const MAX_PRESIGN_EXPIRES_SECONDS = 7 * 24 * 60 * 60;

function parseBooleanEnv(
  value: string | undefined,
  fallbackValue: boolean
): boolean {
  if (!value) {
    return fallbackValue;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallbackValue;
}

function resolveConfig(): S3Config {
  const endpointRaw =
    process.env.S3_ENDPOINT?.trim() || process.env.MINIO_ENDPOINT?.trim() || '';
  const bucket = process.env.S3_BUCKET?.trim() || 'agentifui';
  const region = process.env.S3_REGION?.trim() || 'us-east-1';
  const accessKeyId =
    process.env.S3_ACCESS_KEY_ID?.trim() ||
    process.env.MINIO_ROOT_USER?.trim() ||
    '';
  const secretAccessKey =
    process.env.S3_SECRET_ACCESS_KEY?.trim() ||
    process.env.MINIO_ROOT_PASSWORD?.trim() ||
    '';

  if (!endpointRaw || !accessKeyId || !secretAccessKey) {
    throw new Error(
      'S3_ENDPOINT, S3_ACCESS_KEY_ID, and S3_SECRET_ACCESS_KEY are required'
    );
  }

  return {
    endpoint: new URL(endpointRaw),
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
  };
}

export function isStoragePublicReadEnabled(): boolean {
  return parseBooleanEnv(process.env.S3_PUBLIC_READ_ENABLED, true);
}

function sha256Hex(data: string | Buffer): string {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function hmacSha256(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function formatAmzDate(date: Date) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map(segment => encodeRfc3986(segment))
    .join('/');
}

function canonicalQueryString(query: URLSearchParams): string {
  const entries = Array.from(query.entries()).sort(
    ([aKey, aValue], [bKey, bValue]) => {
      if (aKey === bKey) {
        return aValue.localeCompare(bValue);
      }
      return aKey.localeCompare(bKey);
    }
  );

  return entries
    .map(([key, value]) => `${encodeRfc3986(key)}=${encodeRfc3986(value)}`)
    .join('&');
}

function buildCanonicalUri(config: S3Config, key?: string): string {
  const keyPath = key ? `/${encodePath(key)}` : '';
  const basePath = config.endpoint.pathname.replace(/\/$/, '');
  return `${basePath}/${config.bucket}${keyPath}`.replace(/\/{2,}/g, '/');
}

function buildObjectUrl(
  config: S3Config,
  key?: string,
  query?: URLSearchParams
): URL {
  const url = new URL(config.endpoint.toString());
  url.pathname = buildCanonicalUri(config, key);
  if (query) {
    query.forEach((value, name) => {
      url.searchParams.set(name, value);
    });
  }
  return url;
}

function buildSigningKey(config: S3Config, dateStamp: string): Buffer {
  const kDate = hmacSha256(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, config.region);
  const kService = hmacSha256(kRegion, 's3');
  return hmacSha256(kService, 'aws4_request');
}

function resolvePresignExpires(expiresInSeconds: number | undefined): number {
  const candidate = Number(expiresInSeconds || DEFAULT_PRESIGN_EXPIRES_SECONDS);
  if (!Number.isFinite(candidate)) {
    return DEFAULT_PRESIGN_EXPIRES_SECONDS;
  }

  const normalized = Math.floor(candidate);
  if (normalized < 1) {
    return 1;
  }

  if (normalized > MAX_PRESIGN_EXPIRES_SECONDS) {
    return MAX_PRESIGN_EXPIRES_SECONDS;
  }

  return normalized;
}

async function signedRequest(options: {
  method: SignedMethod;
  key?: string;
  query?: URLSearchParams;
  body?: Buffer;
  contentType?: string;
}) {
  const config = resolveConfig();
  const now = new Date();
  const { amzDate, dateStamp } = formatAmzDate(now);
  const query = options.query || new URLSearchParams();
  const payloadHash = sha256Hex(options.body || '');

  const url = buildObjectUrl(config, options.key, query);
  const canonicalUri = buildCanonicalUri(config, options.key);

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };

  if (options.contentType) {
    headers['content-type'] = options.contentType;
  }

  const signedHeaderKeys = Object.keys(headers).sort();
  const canonicalHeaders = signedHeaderKeys
    .map(key => `${key}:${headers[key].trim()}\n`)
    .join('');
  const signedHeaders = signedHeaderKeys.join(';');

  const canonicalRequest = [
    options.method,
    canonicalUri,
    canonicalQueryString(query),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = hmacSha256(
    buildSigningKey(config, dateStamp),
    stringToSign
  ).toString('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url.toString(), {
    method: options.method,
    headers,
    body: options.body,
  });
}

function buildPresignedUrl(input: PresignInput): string {
  const config = resolveConfig();
  const now = new Date();
  const { amzDate, dateStamp } = formatAmzDate(now);
  const expires = resolvePresignExpires(input.expiresInSeconds);

  const query = new URLSearchParams(input.query || undefined);
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;

  query.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  query.set('X-Amz-Credential', `${config.accessKeyId}/${credentialScope}`);
  query.set('X-Amz-Date', amzDate);
  query.set('X-Amz-Expires', String(expires));
  query.set('X-Amz-SignedHeaders', 'host');

  const canonicalUri = buildCanonicalUri(config, input.key);
  const url = buildObjectUrl(config, input.key, query);

  const canonicalRequest = [
    input.method,
    canonicalUri,
    canonicalQueryString(query),
    `host:${url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signature = hmacSha256(
    buildSigningKey(config, dateStamp),
    stringToSign
  ).toString('hex');

  query.set('X-Amz-Signature', signature);

  const signedUrl = buildObjectUrl(config, input.key, query);
  return signedUrl.toString();
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'");
}

export async function putObject(
  namespace: string,
  filePath: string,
  bytes: Buffer,
  contentType: string
) {
  const key = `${namespace}/${filePath}`;
  const response = await signedRequest({
    method: 'PUT',
    key,
    body: bytes,
    contentType,
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Failed to upload object: ${response.status} ${bodyText}`);
  }
}

export async function deleteObject(namespace: string, filePath: string) {
  const key = `${namespace}/${filePath}`;
  const response = await signedRequest({
    method: 'DELETE',
    key,
  });

  if (!response.ok && response.status !== 404) {
    const bodyText = await response.text();
    throw new Error(`Failed to delete object: ${response.status} ${bodyText}`);
  }
}

export async function listObjects(namespace: string, prefix: string) {
  const prefixed = `${namespace}/${prefix}`.replace(/\/{2,}/g, '/');
  const response = await signedRequest({
    method: 'GET',
    query: new URLSearchParams({
      'list-type': '2',
      prefix: prefixed,
    }),
  });

  if (!response.ok) {
    const bodyText = await response.text();
    throw new Error(`Failed to list objects: ${response.status} ${bodyText}`);
  }

  const xml = await response.text();
  const matches = [...xml.matchAll(/<Key>(.*?)<\/Key>/g)];
  const keys = matches.map(match => decodeXmlEntities(match[1] || ''));

  return keys
    .filter(key => key.startsWith(`${namespace}/`))
    .map(key => key.slice(namespace.length + 1));
}

export async function headObject(
  namespace: string,
  filePath: string
): Promise<HeadObjectResult> {
  const key = `${namespace}/${filePath}`;
  const response = await signedRequest({
    method: 'HEAD',
    key,
  });

  if (response.status === 404) {
    return {
      exists: false,
      status: response.status,
      contentType: null,
      contentLength: null,
      eTag: null,
      lastModified: null,
    };
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => '');
    throw new Error(`Failed to head object: ${response.status} ${bodyText}`);
  }

  const contentLengthRaw = response.headers.get('content-length');
  const contentLength = contentLengthRaw
    ? Number(contentLengthRaw)
    : Number.NaN;

  return {
    exists: true,
    status: response.status,
    contentType: response.headers.get('content-type'),
    contentLength: Number.isFinite(contentLength) ? contentLength : null,
    eTag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  };
}

export function createPresignedUploadUrl(
  namespace: string,
  filePath: string,
  options: { expiresInSeconds?: number } = {}
): string {
  return buildPresignedUrl({
    method: 'PUT',
    key: `${namespace}/${filePath}`,
    expiresInSeconds: options.expiresInSeconds,
  });
}

export function createPresignedDownloadUrl(
  namespace: string,
  filePath: string,
  options: { expiresInSeconds?: number; responseContentType?: string } = {}
): string {
  const query = new URLSearchParams();
  if (options.responseContentType) {
    query.set('response-content-type', options.responseContentType);
  }

  return buildPresignedUrl({
    method: 'GET',
    key: `${namespace}/${filePath}`,
    expiresInSeconds: options.expiresInSeconds,
    query,
  });
}

export function buildPublicObjectUrl(namespace: string, filePath: string) {
  const config = resolveConfig();
  const publicBaseUrl = process.env.S3_PUBLIC_BASE_URL?.trim();
  const encodedKey = encodePath(`${namespace}/${filePath}`);

  if (publicBaseUrl) {
    return `${publicBaseUrl.replace(/\/$/, '')}/${encodedKey}`;
  }

  const basePath = config.endpoint.pathname.replace(/\/$/, '');
  const url = new URL(config.endpoint.origin);
  url.pathname = `${basePath}/${config.bucket}/${encodedKey}`.replace(
    /\/{2,}/g,
    '/'
  );

  return url.toString().replace(/\/$/, '');
}

export function extractPathFromPublicUrl(
  publicUrl: string,
  namespace: string
): string | null {
  try {
    const config = resolveConfig();
    const parsed = new URL(publicUrl);
    const segments = parsed.pathname
      .split('/')
      .filter(Boolean)
      .map(segment => decodeURIComponent(segment));

    const bucketIndex = segments.indexOf(config.bucket);
    if (bucketIndex !== -1 && bucketIndex < segments.length - 2) {
      const namespaceSegment = segments[bucketIndex + 1];
      if (namespaceSegment === namespace) {
        return segments.slice(bucketIndex + 2).join('/');
      }
    }

    const namespaceIndex = segments.indexOf(namespace);
    if (namespaceIndex !== -1 && namespaceIndex < segments.length - 1) {
      return segments.slice(namespaceIndex + 1).join('/');
    }

    return null;
  } catch {
    return null;
  }
}
