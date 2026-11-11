/** @jest-environment node */
import {
  sendResetPasswordEmail,
  sendVerificationEmail,
} from '@lib/auth/better-auth/email';
import { reserveAuthEmail } from '@lib/auth/better-auth/email-rate-limit';
import { createTransport } from 'nodemailer';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
jest.mock('@lib/auth/better-auth/email-rate-limit', () => ({
  reserveAuthEmail: jest.fn(),
}));

const originalEnv = process.env;
const sendMail = jest.fn();
const payload = {
  user: { email: ' Person@Example.com ', name: 'Test Person' },
  url: 'https://app.example.com/api/auth/better/verify-email?token=test&callbackURL=%2Fchat',
  token: 'test-only-email-token',
};

describe('authentication emails', () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const name of Object.keys(process.env)) {
      if (
        name.startsWith('SMTP_') ||
        name.startsWith('AUTH_EMAIL_') ||
        name.startsWith('AUTH_RESET_PASSWORD_')
      ) {
        delete process.env[name];
      }
    }
    delete (globalThis as unknown as Record<string, unknown>)[
      '__agentifui_smtp_transporter__'
    ];
    jest.clearAllMocks();
    (reserveAuthEmail as jest.Mock).mockResolvedValue(true);
    (createTransport as jest.Mock).mockReturnValue({ sendMail });
    sendMail.mockResolvedValue({ accepted: ['person@example.com'] });
    jest.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = originalEnv;
    delete (globalThis as unknown as Record<string, unknown>)[
      '__agentifui_smtp_transporter__'
    ];
    jest.restoreAllMocks();
  });

  function configureSmtp() {
    process.env.AUTH_EMAIL_VERIFICATION_MODE = 'smtp';
    process.env.AUTH_RESET_PASSWORD_MODE = 'smtp';
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_PORT = '465';
    process.env.SMTP_USER = 'test-mailer';
    process.env.SMTP_PASSWORD = 'test-only-smtp-password';
    process.env.SMTP_FROM = 'Example Assistant <no-reply@example.com>';
  }

  it('defaults both email types to explicit development logging', async () => {
    await sendVerificationEmail(payload);
    await sendResetPasswordEmail(payload);

    expect(createTransport).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();
    expect(reserveAuthEmail).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledTimes(2);
    expect(console.info).toHaveBeenCalledWith(
      expect.stringContaining('verification requested (dev-log mode)'),
      expect.stringContaining(payload.url)
    );
  });

  it('sends registration verification with the supplied link and shared SMTP', async () => {
    configureSmtp();
    await sendVerificationEmail(payload);

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 465,
      secure: true,
      requireTLS: false,
      auth: { user: 'test-mailer', pass: 'test-only-smtp-password' },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 30000,
    });
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: process.env.SMTP_FROM,
        to: 'person@example.com',
        subject: 'Verify your AgentifUI email address',
        text: expect.stringContaining(payload.url),
        html: expect.stringContaining('Verify email address</a>'),
      })
    );
    expect(console.info).not.toHaveBeenCalled();
    expect(sendMail.mock.calls[0][0].text).not.toContain(payload.token);
  });

  it('keeps reset-password overrides and reuses the same transporter', async () => {
    configureSmtp();
    process.env.AUTH_RESET_PASSWORD_EMAIL_FROM = 'Reset <reset@example.com>';
    process.env.AUTH_RESET_PASSWORD_SUBJECT = 'Custom password reset';
    await sendVerificationEmail(payload);
    await sendResetPasswordEmail({
      ...payload,
      url: 'https://app.example.com/reset-password?token=reset-test',
    });

    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: 'Reset <reset@example.com>',
        subject: 'Custom password reset',
        text: expect.stringContaining('/reset-password?token=reset-test'),
        html: expect.stringContaining('Reset password</a>'),
      })
    );
  });

  it('supports verification-specific sender and subject overrides', async () => {
    configureSmtp();
    process.env.AUTH_EMAIL_VERIFICATION_EMAIL_FROM =
      'Verify <verify@example.com>';
    process.env.AUTH_EMAIL_VERIFICATION_SUBJECT = 'Confirm your address';
    await sendVerificationEmail(payload);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Verify <verify@example.com>',
        subject: 'Confirm your address',
      })
    );
  });

  it('escapes HTML names and link attributes while preserving the plain-text URL', async () => {
    configureSmtp();
    const unsafe = {
      ...payload,
      user: { ...payload.user, name: '<img src=x onerror="alert(1)">' },
      url: 'https://app.example.com/verify?token=test&name="quoted"',
    };
    await sendVerificationEmail(unsafe);
    const message = sendMail.mock.calls[0][0];
    expect(message.html).toContain('&lt;img');
    expect(message.html).not.toContain('<img');
    expect(message.html).toContain('&amp;name=&quot;quoted&quot;');
    expect(message.text).toContain(unsafe.url);
  });

  it('does not switch reset emails to SMTP just because verification uses SMTP', async () => {
    configureSmtp();
    delete process.env.AUTH_RESET_PASSWORD_MODE;
    await sendResetPasswordEmail(payload);
    expect(createTransport).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledTimes(1);
  });

  it('uses STARTTLS defaults for port 587 and permits an unauthenticated relay', async () => {
    configureSmtp();
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_USER;
    await sendVerificationEmail(payload);
    expect(createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        port: 587,
        secure: false,
        auth: undefined,
      })
    );
  });

  it.each(['true', '1', 'yes', 'on'])(
    'accepts SMTP_SECURE=%s',
    async secure => {
      configureSmtp();
      process.env.SMTP_PORT = '2465';
      process.env.SMTP_SECURE = secure;
      await sendVerificationEmail(payload);
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ secure: true })
      );
    }
  );

  it.each(['false', '0', 'no', 'off'])(
    'accepts SMTP_SECURE=%s',
    async secure => {
      configureSmtp();
      process.env.SMTP_SECURE = secure;
      await sendVerificationEmail(payload);
      expect(createTransport).toHaveBeenCalledWith(
        expect.objectContaining({ secure: false })
      );
    }
  );

  it.each(['0', '65536', '-1', '1.5', 'invalid'])(
    'rejects invalid SMTP port %s',
    async port => {
      configureSmtp();
      process.env.SMTP_PORT = port;
      await expect(sendVerificationEmail(payload)).rejects.toThrow('SMTP_PORT');
      expect(sendMail).not.toHaveBeenCalled();
    }
  );

  it('rejects missing SMTP configuration without logging the verification token', async () => {
    configureSmtp();
    delete process.env.SMTP_HOST;
    await expect(sendVerificationEmail(payload)).rejects.toThrow('SMTP_HOST');
    expect(sendMail).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });

  it.each([sendVerificationEmail, sendResetPasswordEmail])(
    'propagates delivery failures without a log fallback',
    async send => {
      configureSmtp();
      sendMail.mockRejectedValue(new Error('Synthetic SMTP failure'));
      await expect(send(payload)).rejects.toThrow('Synthetic SMTP failure');
      expect(console.info).not.toHaveBeenCalled();
    }
  );

  it('rejects an unknown sender mode instead of exposing tokens to logs', async () => {
    process.env.AUTH_EMAIL_VERIFICATION_MODE = 'smpt';
    await expect(sendVerificationEmail(payload)).rejects.toThrow(
      'AUTH_EMAIL_VERIFICATION_MODE'
    );
    expect(console.info).not.toHaveBeenCalled();
  });

  it('rejects an invalid TLS setting instead of silently disabling TLS', async () => {
    configureSmtp();
    process.env.SMTP_SECURE = 'invalid';
    await expect(sendVerificationEmail(payload)).rejects.toThrow('SMTP_SECURE');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rejects an empty recipient', async () => {
    await expect(
      sendVerificationEmail({ ...payload, user: { email: ' ' } })
    ).rejects.toThrow('email address');
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('preserves the existing password-reset module export', async () => {
    const legacy = await import('@lib/auth/better-auth/password-reset');
    expect(legacy.sendResetPasswordEmail).toBe(sendResetPasswordEmail);
  });

  it.each([
    [sendVerificationEmail, 'verification'],
    [sendResetPasswordEmail, 'password-reset'],
  ] as const)(
    'reserves a normalized recipient before sending %s',
    async (send, kind) => {
      configureSmtp();
      await send(payload);
      expect(reserveAuthEmail).toHaveBeenCalledWith('person@example.com', kind);
      expect(
        jest.mocked(reserveAuthEmail).mock.invocationCallOrder[0]
      ).toBeLessThan(sendMail.mock.invocationCallOrder[0]);
    }
  );

  it.each([sendVerificationEmail, sendResetPasswordEmail])(
    'silently suppresses delivery when the mailbox quota is exhausted',
    async send => {
      configureSmtp();
      (reserveAuthEmail as jest.Mock).mockResolvedValue(false);
      await expect(send(payload)).resolves.toBeUndefined();
      expect(sendMail).not.toHaveBeenCalled();
      expect(console.info).not.toHaveBeenCalled();
    }
  );

  it('does not send or expose tokens if the shared limiter fails', async () => {
    configureSmtp();
    (reserveAuthEmail as jest.Mock).mockRejectedValue(
      new Error('Redis unavailable')
    );
    await expect(sendVerificationEmail(payload)).rejects.toThrow(
      'Redis unavailable'
    );
    expect(sendMail).not.toHaveBeenCalled();
    expect(console.info).not.toHaveBeenCalled();
  });
});
