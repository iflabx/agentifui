interface PasswordResetPayload {
  user: {
    email?: string | null;
    name?: string | null;
  };
  url: string;
  token: string;
}

type PasswordResetMode = 'dev-log' | 'smtp';

const SMTP_TRANSPORTER_KEY = '__agentifui_smtp_transporter__';

function normalizeEmail(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return fallback;
}

function getPasswordResetMode(): PasswordResetMode {
  const raw = process.env.AUTH_RESET_PASSWORD_MODE?.trim().toLowerCase();
  if (raw === 'smtp') {
    return 'smtp';
  }

  if (raw && raw !== 'dev-log') {
    console.warn(
      `[better-auth] unsupported AUTH_RESET_PASSWORD_MODE="${raw}", fallback to dev-log`
    );
  }

  return 'dev-log';
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    throw new Error('SMTP_HOST is required when AUTH_RESET_PASSWORD_MODE=smtp');
  }

  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isFinite(port) || port <= 0) {
    throw new Error('SMTP_PORT must be a positive number');
  }

  const user = process.env.SMTP_USER?.trim();
  const password = process.env.SMTP_PASSWORD?.trim();
  const secure = parseBoolean(process.env.SMTP_SECURE, port === 465);

  return {
    host,
    port,
    secure,
    auth: user ? { user, pass: password || '' } : undefined,
  };
}

function getMailFromAddress(): string {
  return (
    process.env.AUTH_RESET_PASSWORD_EMAIL_FROM?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    'AgentifUI <no-reply@localhost>'
  );
}

function getMailSubject(): string {
  return (
    process.env.AUTH_RESET_PASSWORD_SUBJECT?.trim() ||
    'AgentifUI Password Reset'
  );
}

async function getSmtpTransporter() {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[SMTP_TRANSPORTER_KEY];
  if (existing) {
    return existing as {
      sendMail: (message: {
        from: string;
        to: string;
        subject: string;
        text: string;
        html: string;
      }) => Promise<unknown>;
    };
  }

  const nodemailerModule = await import('nodemailer');
  const transporter = nodemailerModule.createTransport(getSmtpConfig());
  globalState[SMTP_TRANSPORTER_KEY] = transporter;
  return transporter;
}

async function sendResetPasswordBySmtp(
  email: string,
  payload: PasswordResetPayload
) {
  const transporter = await getSmtpTransporter();
  const displayName =
    typeof payload.user.name === 'string' && payload.user.name.trim()
      ? payload.user.name.trim()
      : 'there';

  const subject = getMailSubject();
  const from = getMailFromAddress();

  const text = [
    `Hello ${displayName},`,
    '',
    'We received a request to reset your AgentifUI password.',
    'Open the link below to continue:',
    payload.url,
    '',
    `Token: ${payload.token}`,
    '',
    'If you did not request this change, please ignore this email.',
  ].join('\n');

  const html = [
    `<p>Hello ${displayName},</p>`,
    '<p>We received a request to reset your AgentifUI password.</p>',
    `<p><a href="${payload.url}">Reset password</a></p>`,
    `<p>Token: <code>${payload.token}</code></p>`,
    '<p>If you did not request this change, please ignore this email.</p>',
  ].join('');

  await transporter.sendMail({
    from,
    to: email,
    subject,
    text,
    html,
  });
}

function logResetPasswordPayload(email: string, payload: PasswordResetPayload) {
  console.info(
    '[better-auth] password reset requested (dev-log mode):',
    JSON.stringify(
      {
        email,
        url: payload.url,
        token: payload.token,
      },
      null,
      2
    )
  );
}

export async function sendResetPasswordEmail(payload: PasswordResetPayload) {
  const email = normalizeEmail(payload.user?.email);
  if (!email) {
    console.warn(
      '[better-auth] request-password-reset skipped: user email is empty'
    );
    return;
  }

  const mode = getPasswordResetMode();
  if (mode === 'smtp') {
    await sendResetPasswordBySmtp(email, payload);
    return;
  }

  logResetPasswordPayload(email, payload);
}
