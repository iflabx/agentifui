import {
  ADMIN_API_BASE_PATH,
  BETTER_AUTH_BASE_PATH,
  INTERNAL_DATA_BASE_PATH,
  INTERNAL_PROFILE_STATUS_PATH,
  INTERNAL_REALTIME_BASE_PATH,
  INTERNAL_STORAGE_BASE_PATH,
} from './constants';

export function isAuthPage(pathname: string): boolean {
  return (
    pathname === '/login' ||
    pathname.startsWith('/register') ||
    pathname === '/forgot-password' ||
    pathname === '/reset-password' ||
    pathname === '/phone-login'
  );
}

export function isPublicRoute(pathname: string): boolean {
  if (
    pathname === '/' ||
    pathname === '/about' ||
    pathname.startsWith('/sso/processing')
  ) {
    return true;
  }

  if (
    process.env.NEXT_PUBLIC_SSO_ONLY_MODE !== 'true' &&
    isAuthPage(pathname)
  ) {
    return true;
  }

  return (
    process.env.NEXT_PUBLIC_SSO_ONLY_MODE === 'true' && pathname === '/login'
  );
}

export function shouldSkipMiddlewareAuthProxy(pathname: string): boolean {
  return (
    pathname.startsWith(BETTER_AUTH_BASE_PATH) ||
    pathname.startsWith(INTERNAL_DATA_BASE_PATH) ||
    pathname.startsWith(INTERNAL_PROFILE_STATUS_PATH) ||
    pathname.startsWith('/api/auth/sso/providers') ||
    pathname.startsWith(ADMIN_API_BASE_PATH) ||
    pathname.startsWith(INTERNAL_STORAGE_BASE_PATH) ||
    pathname.startsWith(INTERNAL_REALTIME_BASE_PATH)
  );
}
