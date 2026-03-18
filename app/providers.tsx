'use client';

import { useEffect, useState } from 'react';

import { ThemeProvider } from 'next-themes';

export function Providers({ children }: { children: React.ReactNode }) {
  // Avoid hydration mismatch, ensure ThemeProvider is loaded only when rendering on the client
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

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
