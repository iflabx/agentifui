import crypto from 'node:crypto';

type S3Config = {
  endpoint: URL;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

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

function encodePath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

function canonicalQueryString(query: URLSearchParams): string {
  const entries = Array.from(query.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return entries
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
    )
    .join('&');
}

async function signedRequest(options: {
  method: 'GET' | 'PUT' | 'DELETE';
  key?: string;
  query?: URLSearchParams;
  body?: Buffer;
  contentType?: string;
}) {
  const config = resolveConfig();
  const now = new Date();
  const { amzDate, dateStamp } = formatAmzDate(now);
  const query = options.query || new URLSearchParams();
  const body = options.body;
  const payloadHash = sha256Hex(body || '');

  const keyPath = options.key ? `/${encodePath(options.key)}` : '';
  const basePath = config.endpoint.pathname.replace(/\/$/, '');
  const canonicalUri = `${basePath}/${config.bucket}${keyPath}`.replace(
    /\/{2,}/g,
    '/'
  );

  const url = new URL(config.endpoint.toString());
  url.pathname = canonicalUri;
  query.forEach((value, key) => {
    url.searchParams.set(key, value);
  });

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

  const kDate = hmacSha256(`AWS4${config.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, config.region);
  const kService = hmacSha256(kRegion, 's3');
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = hmacSha256(kSigning, stringToSign).toString('hex');

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return fetch(url.toString(), {
    method: options.method,
    headers,
    body,
  });
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
