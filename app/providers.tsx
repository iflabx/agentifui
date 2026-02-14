'use client';

import { getCurrentSession } from '@lib/auth/better-auth/http-client';
import { useCurrentAppStore } from '@lib/stores/current-app-store';

import { useEffect, useState } from 'react';

import { ThemeProvider } from 'next-themes';

export function Providers({ children }: { children: React.ReactNode }) {
  // Avoid hydration mismatch, ensure ThemeProvider is loaded only when rendering on the client
  const [mounted, setMounted] = useState(false);
  const [, setUserChecked] = useState(false);

  // Use hook to get initialization method, following React best practices
  const initializeDefaultAppId = useCurrentAppStore(
    state => state.initializeDefaultAppId
  );

  useEffect(() => {
    setMounted(true);

    // Security fix: Only initialize app storage when user is logged in
    // Prevent unnecessary cache creation for unlogged users
    const checkUserAndInitialize = async () => {
      try {
        const sessionPayload = (await getCurrentSession()) as {
          user?: { id?: string } | null;
        } | null;
        const user = sessionPayload?.user ?? null;

        setUserChecked(true);

        if (user?.id) {
          console.log('[Providers] User logged in, initializing app storage');
          // Only initialize default App ID when user is logged in
          await initializeDefaultAppId();
        } else {
          console.log(
            '[Providers] User not logged in, skipping app storage initialization'
          );
        }
      } catch (error) {
        console.warn('[Providers] Checking user status failed:', error);
        setUserChecked(true);
      }
    };

    checkUserAndInitialize();
  }, [initializeDefaultAppId]);

  if (!mounted) {
    // Don't render children before ThemeProvider is ready, or render a minimal placeholder
    // Return null to ensure children don't attempt to render without theme context
    return null;
  }

  return (
    <ThemeProvider
      attribute="class" // Use class attribute to switch theme (TailwindCSS class mode)
      defaultTheme="system" // Default to system theme
      enableSystem={true} // Enable system theme detection
      disableTransitionOnChange // Disable transition effect to avoid flickering
    >
      {children}
    </ThemeProvider>
  );
}
