import LoginPageContent from '@components/auth/login-page-content';
import { isPhoneNumberAuthEnabled } from '@lib/auth/better-auth/server/env';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return <LoginPageContent phoneLoginEnabled={isPhoneNumberAuthEnabled()} />;
}
