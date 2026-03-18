import { ClientLayout } from '@components/layouts/client-layout';
import { ShellBootstrap } from '@components/layouts/shell-bootstrap';
import { ConditionalNavBar } from '@components/nav-bar/conditional-nav-bar';
import { ConditionalSidebar } from '@components/sidebar/conditional-sidebar';

export default function ShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      <ShellBootstrap />
      <ClientLayout>
        <ConditionalSidebar />
        <ConditionalNavBar />
        {children}
      </ClientLayout>
    </>
  );
}
