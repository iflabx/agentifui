function isTruthyEnv(value: string | null | undefined): boolean {
  const normalized = (value || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

/**
 * Build PostgreSQL session options passed at connection startup.
 */
export function resolvePgSessionOptionsFromEnv(): string | undefined {
  const options: string[] = [];

  if (isTruthyEnv(process.env.APP_RLS_STRICT_MODE)) {
    options.push(`-c app.rls_strict_mode=on`);
  }

  if (options.length === 0) {
    return undefined;
  }

  return options.join(' ');
}
