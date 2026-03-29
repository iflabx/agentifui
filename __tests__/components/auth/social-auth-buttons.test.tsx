import { LoginForm } from '@components/auth/login-form';
import { RegisterForm } from '@components/auth/register-form';
import { SocialAuthButtons } from '@components/auth/social-auth-buttons';
import { render, screen } from '@testing-library/react';

describe('SocialAuthButtons', () => {
  const originalGitHubLoginFlag = process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED;
  const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    mockedFetch.mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: true,
        providers: [],
      }),
    } as unknown as Response);
  });

  afterEach(() => {
    if (typeof originalGitHubLoginFlag === 'string') {
      process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED = originalGitHubLoginFlag;
    } else {
      delete process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED;
    }
  });

  it('renders the GitHub login button when GitHub social login is enabled', () => {
    process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED = 'true';

    render(<SocialAuthButtons type="login" redirectTo="/chat" />);

    expect(
      screen.getByRole('button', { name: 'pages.auth.social.github.login' })
    ).toBeInTheDocument();
  });

  it('hides GitHub register actions when GitHub social login is disabled', () => {
    process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED = 'false';

    render(<RegisterForm />);

    expect(
      screen.queryByRole('button', {
        name: 'pages.auth.social.github.register',
      })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('pages.auth.register.orSeparator')
    ).not.toBeInTheDocument();
    expect(
      screen.getByLabelText('pages.auth.register.emailLabel')
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('pages.auth.register.passwordLabel')
    ).toBeInTheDocument();
  });

  it('keeps the local login form visible when GitHub social login is disabled', () => {
    process.env.NEXT_PUBLIC_GITHUB_LOGIN_ENABLED = 'false';
    mockedFetch.mockImplementationOnce(
      () => new Promise<Response>(() => undefined)
    );

    render(<LoginForm />);

    expect(
      screen.getByLabelText('pages.auth.login.emailLabel')
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText('pages.auth.login.passwordLabel')
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'pages.auth.social.github.login' })
    ).not.toBeInTheDocument();
  });
});
