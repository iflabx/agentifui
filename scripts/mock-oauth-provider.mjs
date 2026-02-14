#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import http from 'node:http';

const port = Number(process.env.MOCK_OAUTH_PORT || 3901);
const host = process.env.MOCK_OAUTH_HOST || '127.0.0.1';

const codeToUser = new Map();
const defaultUserEmail = 'mock.github.user@example.com';

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed || !trimmed.includes('@')) {
    return null;
  }

  return trimmed;
}

function buildStableAccountId(email) {
  const hash = createHash('sha256').update(email).digest('hex').slice(0, 16);
  return `mock-gh-${hash}`;
}

function profileFromLoginHint(loginHint) {
  const email = normalizeEmail(loginHint) || defaultUserEmail;
  const accountId = buildStableAccountId(email);
  const loginName = `mock-${accountId.slice(-8)}`;

  return {
    id: accountId,
    sub: accountId,
    login: loginName,
    preferred_username: loginName,
    name: 'Mock GitHub User',
    email,
    image: 'https://example.com/mock-avatar.png',
    emailVerified: true,
    email_verified: true,
  };
}

function getBaseUrl() {
  return `http://${host}:${port}`;
}

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function redirect(res, location) {
  res.writeHead(302, { location });
  res.end();
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      resolve(body);
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const requestUrl = new URL(req.url || '/', `http://${host}:${port}`);
  const baseUrl = getBaseUrl();

  if (
    method === 'GET' &&
    requestUrl.pathname === '/.well-known/openid-configuration'
  ) {
    json(res, 200, {
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/oauth/authorize`,
      token_endpoint: `${baseUrl}/oauth/token`,
      userinfo_endpoint: `${baseUrl}/oauth/userinfo`,
      jwks_uri: `${baseUrl}/oauth/jwks`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: [
        'client_secret_post',
        'client_secret_basic',
      ],
      scopes_supported: ['openid', 'profile', 'email'],
    });
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/oauth/jwks') {
    json(res, 200, { keys: [] });
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/oauth/authorize') {
    const redirectUri = requestUrl.searchParams.get('redirect_uri');
    const state = requestUrl.searchParams.get('state');
    if (!redirectUri || !state) {
      json(res, 400, { error: 'missing redirect_uri/state' });
      return;
    }

    const loginHint = requestUrl.searchParams.get('login_hint');
    const code = randomUUID();
    codeToUser.set(code, profileFromLoginHint(loginHint));

    const callback = new URL(redirectUri);
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', state);
    redirect(res, callback.toString());
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/oauth/token') {
    const rawBody = await parseBody(req);
    const params = new URLSearchParams(rawBody);
    const code = params.get('code');
    if (!code || !codeToUser.has(code)) {
      json(res, 400, { error: 'invalid_code' });
      return;
    }

    json(res, 200, {
      access_token: `mock-access-token-${code}`,
      token_type: 'bearer',
      expires_in: 3600,
      refresh_token: `mock-refresh-token-${code}`,
      scope: 'read:user user:email',
    });
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/oauth/userinfo') {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const code = token.replace(/^mock-access-token-/, '');
    const profile = codeToUser.get(code);
    if (!profile) {
      json(res, 401, { error: 'invalid_token' });
      return;
    }

    json(res, 200, profile);
    return;
  }

  json(res, 404, { error: 'not_found', path: requestUrl.pathname });
});

server.listen(port, host, () => {
  console.log(`[mock-oauth] listening on http://${host}:${port}`);
});

const shutdown = () => {
  server.close(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
