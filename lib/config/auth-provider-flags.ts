const TRUE_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isGitHubSocialLoginEnabled(): boolean {
  const rawValue = process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED;

  if (typeof rawValue !== 'string') {
    return false;
  }

  return TRUE_ENV_VALUES.has(rawValue.trim().toLowerCase());
}
