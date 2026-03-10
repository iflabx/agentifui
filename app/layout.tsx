import { ConditionalNavBar } from '@components/nav-bar';
import { ClientErrorMonitor } from '@components/observability/client-error-monitor';
import { ConditionalSidebar } from '@components/sidebar/conditional-sidebar';
import { DynamicTitle } from '@components/ui/dynamic-title';
import { NotificationBar } from '@components/ui/notification-bar';
import { TooltipContainer } from '@components/ui/tooltip';
import { cn } from '@lib/utils';
import { Toaster } from 'sonner';

import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getMessages } from 'next-intl/server';
import {
  Crimson_Pro,
  Inter,
  Noto_Sans_SC,
  Noto_Serif_SC,
  Playfair_Display,
} from 'next/font/google';

import { ClientLayout } from '../components/layouts/client-layout';
import '../styles/markdown-variables.css';
import '../styles/markdown.css';
import '../styles/prism-custom.css';
import './globals.css';
import { Providers } from './providers';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const notoSansSC = Noto_Sans_SC({
  subsets: ['latin'],
  weight: ['300', '400', '500', '700'],
  variable: '--font-noto-sans',
  display: 'swap',
});

const crimsonPro = Crimson_Pro({
  subsets: ['latin'],
  variable: '--font-crimson',
  display: 'swap',
});

const notoSerifSC = Noto_Serif_SC({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-noto-serif',
  display: 'swap',
});

const playfair = Playfair_Display({
  subsets: ['latin'],
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
      <body>
        <Providers>
          <NextIntlClientProvider messages={messages}>
            <DynamicTitle />
            <ClientErrorMonitor />
            <ClientLayout fontClasses={fontClasses}>
              <ConditionalSidebar />
              <ConditionalNavBar />
              {children}
              <TooltipContainer />
              <NotificationBar />
              <Toaster
                position="top-center"
                richColors
                theme="system"
                className="font-serif"
              />
            </ClientLayout>
          </NextIntlClientProvider>
        </Providers>
      </body>
    </html>
  );
}
