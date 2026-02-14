#!/usr/bin/env node

const REQUIRED_FIELDS = [
  'issuer',
  'authorization_endpoint',
  'token_endpoint',
  'jwks_uri',
];

function normalizeIssuer(issuer) {
  return issuer.endsWith('/') ? issuer.slice(0, -1) : issuer;
}

function computeDiscoveryUrl(provider) {
  if (
    typeof provider.discoveryEndpoint === 'string' &&
    provider.discoveryEndpoint.trim().length > 0
  ) {
    return provider.discoveryEndpoint.trim();
  }

  const normalizedIssuer = normalizeIssuer(provider.issuer.trim());
  return `${normalizedIssuer}/.well-known/openid-configuration`;
}

function parseProviderList(rawValue) {
  if (!rawValue || rawValue.trim().length === 0) {
    return [];
  }

  const parsed = JSON.parse(rawValue);
  if (!Array.isArray(parsed)) {
    throw new Error('BETTER_AUTH_SSO_PROVIDERS_JSON must be a JSON array');
  }

  return parsed.map((provider, index) => {
    if (!provider || typeof provider !== 'object') {
      throw new Error(`provider[${index}] must be an object`);
    }

    const providerId =
      typeof provider.providerId === 'string' && provider.providerId.trim()
        ? provider.providerId.trim()
        : null;
    const issuer =
      typeof provider.issuer === 'string' && provider.issuer.trim()
        ? provider.issuer.trim()
        : null;

    if (!providerId) {
      throw new Error(`provider[${index}] missing providerId`);
    }

    if (!issuer) {
      throw new Error(`provider[${index}] missing issuer`);
    }

    return {
      providerId,
      mode:
        provider.mode === 'cas-bridge' || provider.mode === 'native'
          ? provider.mode
          : 'native',
      issuer,
      discoveryEndpoint:
        typeof provider.discoveryEndpoint === 'string'
          ? provider.discoveryEndpoint
          : undefined,
    };
  });
}

async function fetchDiscovery(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

function missingFields(payload) {
  return REQUIRED_FIELDS.filter(field => typeof payload[field] !== 'string');
}

async function main() {
  const timeoutMs = Number(process.env.OIDC_DISCOVERY_TIMEOUT_MS || 8000);
  const providers = parseProviderList(process.env.BETTER_AUTH_SSO_PROVIDERS_JSON);

  if (providers.length === 0) {
    console.log(
      '[m2:oidc:verify] No providers configured in BETTER_AUTH_SSO_PROVIDERS_JSON'
    );
    return;
  }

  const failed = [];

  for (const provider of providers) {
    const discoveryUrl = computeDiscoveryUrl(provider);
    const prefix = `[m2:oidc:verify] ${provider.providerId} (${provider.mode})`;
    process.stdout.write(`${prefix} -> ${discoveryUrl} ... `);

    try {
      const payload = await fetchDiscovery(discoveryUrl, timeoutMs);
      const missing = missingFields(payload);
      if (missing.length > 0) {
        throw new Error(`missing fields: ${missing.join(', ')}`);
      }

      console.log('ok');
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      console.log(`failed (${reason})`);
      failed.push({ providerId: provider.providerId, reason });
    }
  }

  if (failed.length > 0) {
    console.error('\n[m2:oidc:verify] failed providers:');
    for (const item of failed) {
      console.error(`- ${item.providerId}: ${item.reason}`);
    }
    process.exit(1);
  }

  console.log('\n[m2:oidc:verify] all providers passed discovery checks');
}

main().catch(error => {
  console.error(
    `[m2:oidc:verify] unexpected error: ${error instanceof Error ? error.message : 'unknown'}`
  );
  process.exit(1);
});
