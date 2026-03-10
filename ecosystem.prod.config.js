module.exports = {
  apps: [
    {
      name: 'AgentifUI-Prod',
      script: 'pnpm',
      args: 'start:prod',
      interpreter: 'none',
      env_file: './.env.prod',
      env: {
        NODE_ENV: 'production',
        PORT: process.env.PORT || 3000,
        FASTIFY_PROXY_ENABLED: process.env.FASTIFY_PROXY_ENABLED || '1',
        FASTIFY_PROXY_BASE_URL:
          process.env.FASTIFY_PROXY_BASE_URL || 'http://127.0.0.1:3010',
        FASTIFY_PROXY_PREFIXES: process.env.FASTIFY_PROXY_PREFIXES,
      },
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      out_file: './pm2-logs/prod-out.log',
      error_file: './pm2-logs/prod-error.log',
      autorestart: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'AgentifUI-API-Prod',
      script: 'pnpm',
      args: 'start:prod:api',
      interpreter: 'none',
      env_file: './.env.prod',
      env: {
        NODE_ENV: 'production',
        FASTIFY_API_HOST: process.env.FASTIFY_API_HOST || '0.0.0.0',
        FASTIFY_API_PORT: process.env.FASTIFY_API_PORT || 3010,
        FASTIFY_LOG_LEVEL: process.env.FASTIFY_LOG_LEVEL || 'info',
        FASTIFY_PROXY_PREFIXES: process.env.FASTIFY_PROXY_PREFIXES,
        FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS:
          process.env.FASTIFY_INTERNAL_DATA_PROXY_TIMEOUT_MS || 30000,
        NEXT_UPSTREAM_BASE_URL:
          process.env.NEXT_UPSTREAM_BASE_URL || 'http://127.0.0.1:3000',
      },
      cwd: './',
      instances: 1,
      exec_mode: 'fork',
      out_file: './pm2-logs/prod-api-out.log',
      error_file: './pm2-logs/prod-api-error.log',
      autorestart: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
