#!/usr/bin/env node
import http from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.MOCK_OAUTH_PORT || 3901);
const host = process.env.MOCK_OAUTH_HOST || '127.0.0.1';

const codeToUser = new Map();

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

function profileFromCode(code) {
  return {
    id: `mock-gh-${code.slice(0, 8)}`,
    login: 'mock-github-user',
    name: 'Mock GitHub User',
    email: 'mock.github.user@example.com',
    image: 'https://example.com/mock-avatar.png',
    emailVerified: true,
  };
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const requestUrl = new URL(req.url || '/', `http://${host}:${port}`);

  if (method === 'GET' && requestUrl.pathname === '/oauth/authorize') {
    const redirectUri = requestUrl.searchParams.get('redirect_uri');
    const state = requestUrl.searchParams.get('state');
    if (!redirectUri || !state) {
      json(res, 400, { error: 'missing redirect_uri/state' });
      return;
    }

    const code = randomUUID();
    codeToUser.set(code, profileFromCode(code));

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
