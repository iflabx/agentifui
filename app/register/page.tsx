import RegisterPageContent from '@components/auth/register-page-content';
import { isPhoneNumberAuthEnabled } from '@lib/auth/better-auth/server/env';

export const dynamic = 'force-dynamic';

export default function RegisterPage() {
  return <RegisterPageContent phoneLoginEnabled={isPhoneNumberAuthEnabled()} />;
}
