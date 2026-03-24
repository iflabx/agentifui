'use client';

import { usePathname } from 'next/navigation';

import { Sidebar } from './sidebar';

/**
 * Conditional rendering Sidebar component
 * Determine whether to display Sidebar based on the current route
 *
 * Routes that need to be isolated:
 * - Root directory "/" (homepage)
 * - "/admin" and its sub-routes (admin backend has its own sidebar)
 * - "/login", "/register" and other authentication pages
 */
export function ConditionalSidebar() {
  const pathname = usePathname() ?? '';

  // Routes that need to isolate Sidebar
  const shouldHideSidebar =
    pathname === '/' || // Homepage
    pathname?.startsWith('/about') || // About page
    pathname?.startsWith('/admin') || // Admin backend
    pathname?.startsWith('/login') || // Login page
    pathname?.startsWith('/register') || // Register page
    pathname?.startsWith('/forgot-password') || // Forgot password
    pathname?.startsWith('/reset-password') || // Reset password
    pathname?.startsWith('/phone-login') || // Phone login
    pathname?.startsWith('/sso'); // SSO related pages

  // If the route that needs to be isolated is not rendered, do not render Sidebar
  if (shouldHideSidebar) {
    return null;
  }

  // Other routes render Sidebar normally
  return <Sidebar />;
}
