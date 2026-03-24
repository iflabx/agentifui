'use client';

import { usePathname } from 'next/navigation';

import { NavBar } from './nav-bar';

/**
 * Conditional rendering NavBar component
 * Determine whether to display NavBar based on the current route
 * Reference ConditionalSidebar implementation to avoid flickering caused by route switching
 *
 * Routes that need to hide NavBar:
 * - Root directory "/" (home page)
 * - "/admin" and its sub-routes (admin backend has its own header)
 * - "/login", "/register" and other authentication pages
 * - "/about" About page
 */
export function ConditionalNavBar() {
  const pathname = usePathname() ?? '';

  // Routes that need to hide NavBar
  // Same route judgment logic as ConditionalSidebar
  const shouldHideNavBar =
    pathname === '/' || // Home page
    pathname?.startsWith('/about') || // About page
    pathname?.startsWith('/admin') || // Admin backend
    pathname?.startsWith('/login') || // Login page
    pathname?.startsWith('/register') || // Register page
    pathname?.startsWith('/forgot-password') || // Forgot password
    pathname?.startsWith('/reset-password') || // Reset password
    pathname?.startsWith('/phone-login') || // Phone login
    pathname?.startsWith('/sso'); // SSO related pages

  // If the route that needs to be hidden is not rendered NavBar
  if (shouldHideNavBar) {
    return null;
  }

  // Other routes render NavBar normally
  return <NavBar />;
}
