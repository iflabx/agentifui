const FALSE_ENV_VALUES = new Set(['0', 'false', 'no', 'off']);

export function isGitHubSocialLoginEnabled(): boolean {
  const rawValue = process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED;

  if (typeof rawValue !== 'string') {
    return true;
  }

  return !FALSE_ENV_VALUES.has(rawValue.trim().toLowerCase());
}
