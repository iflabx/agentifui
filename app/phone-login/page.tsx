import PhoneLoginPageContent from '@components/auth/phone-login-page-content';
import { isPhoneNumberAuthEnabled } from '@lib/auth/better-auth/server/env';

import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default function PhoneLoginPage() {
  if (!isPhoneNumberAuthEnabled()) {
    redirect('/login');
  }

  return <PhoneLoginPageContent />;
}
