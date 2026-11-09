const rootDir = __dirname;
const logDir = `${rootDir}/pm2-logs`;

module.exports = {
  apps: [
    {
      name: 'AgentifUI-Prod',
      script: 'pnpm',
      args: 'start:prod',
      interpreter: 'none',
      env_file: `${rootDir}/.env.prod`,
      env: {
        NODE_ENV: 'production',
      },
      cwd: rootDir,
      instances: 1,
      exec_mode: 'fork',
      out_file: `${logDir}/prod-out.log`,
      error_file: `${logDir}/prod-error.log`,
      autorestart: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'AgentifUI-API-Prod',
      script: 'pnpm',
      args: 'start:prod:api',
      interpreter: 'none',
      env_file: `${rootDir}/.env.prod`,
      env: {
        NODE_ENV: 'production',
      },
      cwd: rootDir,
      instances: 1,
      exec_mode: 'fork',
      out_file: `${logDir}/prod-api-out.log`,
      error_file: `${logDir}/prod-api-error.log`,
      autorestart: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
