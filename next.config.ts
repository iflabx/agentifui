import withBundleAnalyzer from '@next/bundle-analyzer';

import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

import pkg from './package.json';

/**
 * Next.js Configuration
 * @description Configure Next.js with traditional webpack to avoid Turbopack font loading issues
 * Integrate next-intl plugin for internationalization support
 * Additional configuration for cross-origin requests and production optimizations
 */

const withNextIntl = createNextIntlPlugin();

// Bundle analyzer for production optimization
const bundleAnalyzer = withBundleAnalyzer({
  enabled: process.env.ANALYZE === 'true',
});

const FASTIFY_REWRITE_BYPASS_HEADER = 'x-agentifui-fastify-bypass';
const DEFAULT_FASTIFY_PROXY_PREFIXES = [
  '/api/internal/data',
  '/api/internal/apps',
  '/api/internal/profile',
  '/api/internal/dify-config',
  '/api/internal/auth/local-password',
  '/api/internal/fastify-health',
  '/api/admin',
  '/api/translations',
];

function parseFastifyProxyPrefixes(raw: string | undefined): string[] {
  const source = raw?.trim() ? raw : DEFAULT_FASTIFY_PROXY_PREFIXES.join(',');
  const seen = new Set<string>();
  return source
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
    .map(value => (value.startsWith('/') ? value : `/${value}`))
    .map(value => (value.length > 1 ? value.replace(/\/+$/, '') : value))
    .filter(value => {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
}

function isFastifyProxyEnabled(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes';
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
  },

  output:
    process.env.NEXT_OUTPUT_MODE === 'standalone' ? 'standalone' : undefined,

  allowedDevOrigins: process.env.DEV_ALLOWED_ORIGINS
    ? process.env.DEV_ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
    : [],

  async rewrites() {
    if (!isFastifyProxyEnabled(process.env.FASTIFY_PROXY_ENABLED)) {
      return [];
    }

    const proxyBaseUrl = process.env.FASTIFY_PROXY_BASE_URL?.trim();
    if (!proxyBaseUrl) {
      return [];
    }
    const normalizedBaseUrl = proxyBaseUrl.replace(/\/+$/, '');
    const proxyPrefixes = parseFastifyProxyPrefixes(
      process.env.FASTIFY_PROXY_PREFIXES
    );
    const rules = proxyPrefixes.flatMap(prefix => [
      {
        source: prefix,
        missing: [{ type: 'header', key: FASTIFY_REWRITE_BYPASS_HEADER }],
        destination: `${normalizedBaseUrl}${prefix}`,
      },
      {
        source: `${prefix}/:path*`,
        missing: [{ type: 'header', key: FASTIFY_REWRITE_BYPASS_HEADER }],
        destination: `${normalizedBaseUrl}${prefix}/:path*`,
      },
    ]);
    return {
      beforeFiles: rules,
      afterFiles: [],
      fallback: [],
    };
  },

  compiler: {
    removeConsole:
      process.env.NODE_ENV === 'production'
        ? {
            exclude: ['error', 'warn'],
          }
        : false,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  typescript: {
    ignoreBuildErrors: false,
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    dangerouslyAllowSVG: true,
    contentDispositionType: 'attachment',
    contentSecurityPolicy: "default-src 'self'; script-src 'none'; sandbox;",
    unoptimized: false,
  },

  webpack: (config, { isServer }) => {
    if (isServer) {
      config.externals = config.externals || [];
      config.externals.push({
        bufferutil: 'bufferutil',
        'utf-8-validate': 'utf-8-validate',
      });
    }

    return config;
  },
};

export default bundleAnalyzer(withNextIntl(nextConfig));
