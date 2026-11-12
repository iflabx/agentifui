import { pathToFileURL } from 'node:url';

export function validateDockerEnvironment(environment) {
  for (const name of [
    'DATABASE_URL',
    'REDIS_URL',
    'AGENTIF_RUNTIME_DIR',
    'BETTER_AUTH_URL',
    'S3_ENDPOINT',
    'S3_PRESIGN_ENDPOINT',
    'S3_BUCKET',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ]) {
    if (!environment[name]?.trim()) throw new Error(`${name} is required`);
  }
  const secret = environment.BETTER_AUTH_SECRET || '';
  if (secret.length < 32 || /replace|change.me|build-only/i.test(secret))
    throw new Error(
      'Set a private BETTER_AUTH_SECRET of at least 32 characters'
    );
  if (!/^[a-f\d]{64}$/i.test(environment.API_ENCRYPTION_KEY || ''))
    throw new Error('API_ENCRYPTION_KEY must be 32 random bytes in hex');
  if (
    environment.S3_SECRET_ACCESS_KEY.length < 24 ||
    /replace|change.me/i.test(environment.S3_SECRET_ACCESS_KEY)
  )
    throw new Error(
      'Set a private S3_SECRET_ACCESS_KEY of at least 24 characters'
    );
  if (environment.APP_RLS_STRICT_MODE !== '1')
    throw new Error('Docker installation requires APP_RLS_STRICT_MODE=1');
  if (environment.MIGRATOR_DATABASE_URL || environment.POSTGRES_PASSWORD)
    throw new Error(
      'Do not give migration credentials to application services'
    );
  for (const name of [
    'DATABASE_URL',
    'REDIS_URL',
    'BETTER_AUTH_URL',
    'S3_ENDPOINT',
    'S3_PRESIGN_ENDPOINT',
  ])
    new URL(environment[name]);
  for (const name of [
    'AUTH_EMAIL_VERIFICATION_MODE',
    'AUTH_RESET_PASSWORD_MODE',
  ]) {
    if (environment[name] !== 'smtp')
      throw new Error(`${name} must be smtp; dev-log is not public-safe`);
  }
  if (!environment.SMTP_HOST?.trim() || !environment.SMTP_FROM?.trim())
    throw new Error(
      'SMTP_HOST and SMTP_FROM are required for authentication email'
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    validateDockerEnvironment(process.env);
  } catch (error) {
    console.error(`[docker] ${error.message}`);
    process.exitCode = 1;
  }
}
