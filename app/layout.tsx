import { BodyReady } from '@components/layouts/body-ready';
import { ClientErrorMonitor } from '@components/observability/client-error-monitor';
import { DynamicTitle } from '@components/ui/dynamic-title';
import { NotificationBar } from '@components/ui/notification-bar';
import { TooltipContainer } from '@components/ui/tooltip';
import { cn } from '@lib/utils';
import { Toaster } from 'sonner';

import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import localFont from 'next/font/local';

import '../styles/markdown-variables.css';
import '../styles/markdown.css';
import '../styles/prism-custom.css';
import './globals.css';
import { Providers } from './providers';

const inter = localFont({
  src: [
    {
      path: './fonts/inter-latin-variable.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  variable: '--font-inter',
  display: 'swap',
});

const notoSansSC = localFont({
  src: [
    {
      path: './fonts/noto-sans-sc-simplified-300.woff2',
      weight: '300',
      style: 'normal',
    },
    {
      path: './fonts/noto-sans-sc-simplified-400.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/noto-sans-sc-simplified-500.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: './fonts/noto-sans-sc-simplified-700.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-noto-sans',
  display: 'swap',
  preload: false,
});

const crimsonPro = localFont({
  src: [
    {
      path: './fonts/crimson-pro-latin-variable.woff2',
      weight: '200 900',
      style: 'normal',
    },
  ],
  variable: '--font-crimson',
  display: 'swap',
});

const notoSerifSC = localFont({
  src: [
    {
      path: './fonts/noto-serif-sc-simplified-400.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/noto-serif-sc-simplified-500.woff2',
      weight: '500',
      style: 'normal',
    },
    {
      path: './fonts/noto-serif-sc-simplified-700.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-noto-serif',
  display: 'swap',
  preload: false,
});

const playfair = localFont({
  src: [
    {
      path: './fonts/playfair-display-latin-400.woff2',
      weight: '400',
      style: 'normal',
    },
    {
      path: './fonts/playfair-display-latin-700.woff2',
      weight: '700',
      style: 'normal',
    },
  ],
  variable: '--font-playfair',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AgentifUI',
  description: 'Enterprise-level large model application',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Get current language environment and translation messages
  const locale = await getLocale();
  const messages = await getMessages();
  // Combine all font variable class names, ensure they are available throughout the application
  const fontClasses = cn(
    inter.variable,
    notoSansSC.variable,
    crimsonPro.variable,
    notoSerifSC.variable,
    playfair.variable
  );

  return (
    <html lang={locale} className={fontClasses} suppressHydrationWarning>
      <head>
        {/* Removed the manually added theme initialization script, let next-themes handle the initial theme setting */}
      </head>
      <body className="antialiased">
        <Providers>
          <NextIntlClientProvider messages={messages}>
            <BodyReady />
            <DynamicTitle />
            <ClientErrorMonitor />
            {children}
            <TooltipContainer />
            <NotificationBar />
            <Toaster
              position="top-center"
              richColors
              theme="system"
              className="font-serif"
            />
          </NextIntlClientProvider>
        </Providers>
      </body>
    </html>
  );
}
