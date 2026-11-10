export function resolvePgRlsStrictModeFromEnv(): 'on' | 'off' | undefined {
  const normalized = (process.env.APP_RLS_STRICT_MODE || '')
    .trim()
    .toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return 'on';
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return 'off';
  }
  return undefined;
}

type PgSessionOptionsInput = {
  systemActor?: boolean;
};

/**
 * Build PostgreSQL session options passed at connection startup.
 */
export function resolvePgSessionOptionsFromEnv(
  input: PgSessionOptionsInput = {}
): string | undefined {
  const options: string[] = [];

  if (resolvePgRlsStrictModeFromEnv() === 'on') {
    options.push(`-c app.rls_strict_mode=on`);
  }

  if (input.systemActor) {
    options.push(`-c app.rls_system_actor=on`);
  }

  if (options.length === 0) {
    return undefined;
  }

  return options.join(' ');
}
