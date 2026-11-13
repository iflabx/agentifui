import { render, screen } from '@testing-library/react';

import { redirect } from 'next/navigation';

import LoginPage, { dynamic as loginDynamic } from '../../../app/login/page';
import PhoneLoginPage, {
  dynamic as phoneDynamic,
} from '../../../app/phone-login/page';
import RegisterPage, {
  dynamic as registerDynamic,
} from '../../../app/register/page';

jest.mock('next/navigation', () => ({
  ...jest.requireActual('next/navigation'),
  useRouter: () => ({ push: jest.fn(), refresh: jest.fn() }),
  useSearchParams: () => new URLSearchParams(),
  redirect: jest.fn(() => {
    throw new Error('REDIRECT');
  }),
}));

jest.mock('@components/auth/phone-login-page-content', () => ({
  __esModule: true,
  default: () => <div>Phone authentication</div>,
}));

jest.mock('@components/auth/sso-button', () => ({
  SSOCard: () => null,
}));

describe('phone login availability', () => {
  const originalFlag = process.env.AUTH_PHONE_OTP_ENABLED;
  const originalSsoOnly = process.env.NEXT_PUBLIC_SSO_ONLY_MODE;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_SSO_ONLY_MODE = 'false';
    (fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, providers: [] }),
    });
  });

  afterEach(() => {
    if (originalFlag === undefined) delete process.env.AUTH_PHONE_OTP_ENABLED;
    else process.env.AUTH_PHONE_OTP_ENABLED = originalFlag;
    if (originalSsoOnly === undefined)
      delete process.env.NEXT_PUBLIC_SSO_ONLY_MODE;
    else process.env.NEXT_PUBLIC_SSO_ONLY_MODE = originalSsoOnly;
  });

  it('reads availability per request instead of prerendering the pages', () => {
    expect([loginDynamic, registerDynamic, phoneDynamic]).toEqual([
      'force-dynamic',
      'force-dynamic',
      'force-dynamic',
    ]);
  });

  it.each(['false', '0', 'off', 'no'])(
    'hides both links when disabled with %s',
    flag => {
      process.env.AUTH_PHONE_OTP_ENABLED = flag;
      const login = render(LoginPage());
      expect(
        screen.queryByRole('link', { name: 'pages.auth.login.phoneLoginLink' })
      ).not.toBeInTheDocument();
      expect(
        screen.getByLabelText('pages.auth.login.emailLabel')
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', {
          name: 'pages.auth.login.forgotPasswordLink',
        })
      ).toBeInTheDocument();
      login.unmount();
      render(RegisterPage());
      expect(
        screen.queryByRole('link', {
          name: 'pages.auth.register.phoneLoginLink',
        })
      ).not.toBeInTheDocument();
      expect(
        screen.getByLabelText('pages.auth.register.emailLabel')
      ).toBeInTheDocument();
    }
  );

  it.each([undefined, 'true', '1', 'on', 'invalid'])(
    'preserves enabled/default behavior for %s',
    flag => {
      if (flag === undefined) delete process.env.AUTH_PHONE_OTP_ENABLED;
      else process.env.AUTH_PHONE_OTP_ENABLED = flag;
      const login = render(LoginPage());
      expect(
        screen.getByRole('link', { name: 'pages.auth.login.phoneLoginLink' })
      ).toHaveAttribute('href', '/phone-login');
      login.unmount();
      render(RegisterPage());
      expect(
        screen.getByRole('link', { name: 'pages.auth.register.phoneLoginLink' })
      ).toHaveAttribute('href', '/phone-login');
    }
  );

  it('redirects direct phone page visits when disabled', () => {
    process.env.AUTH_PHONE_OTP_ENABLED = 'false';
    expect(() => PhoneLoginPage()).toThrow('REDIRECT');
    expect(redirect).toHaveBeenCalledWith('/login');
  });

  it('renders phone login when enabled', () => {
    process.env.AUTH_PHONE_OTP_ENABLED = 'true';
    render(PhoneLoginPage());
    expect(screen.getByText('Phone authentication')).toBeInTheDocument();
    expect(redirect).not.toHaveBeenCalled();
  });

  it('keeps GitHub login available when phone authentication is disabled', () => {
    const originalGithub = process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED;
    process.env.AUTH_PHONE_OTP_ENABLED = 'false';
    process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED = 'true';
    try {
      render(LoginPage());
      expect(
        screen.getByRole('button', { name: 'pages.auth.social.github.login' })
      ).toBeInTheDocument();
    } finally {
      if (originalGithub === undefined)
        delete process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED;
      else process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED = originalGithub;
    }
  });
});
