import { type AuthEmailKind, reserveAuthEmail } from './email-rate-limit';

export interface AuthEmailPayload {
  user: {
    email?: string | null;
    name?: string | null;
  };
  url: string;
  token: string;
}

const SMTP_TRANSPORTER_KEY = '__agentifui_smtp_transporter__';

const EMAIL_SETTINGS = {
  'password-reset': {
    mode: 'AUTH_RESET_PASSWORD_MODE',
    subject: 'AUTH_RESET_PASSWORD_SUBJECT',
    from: 'AUTH_RESET_PASSWORD_EMAIL_FROM',
    defaultSubject: 'AgentifUI Password Reset',
    description: 'We received a request to reset your AgentifUI password.',
    action: 'Reset password',
    disclaimer: 'If you did not request this change, please ignore this email.',
  },
  verification: {
    mode: 'AUTH_EMAIL_VERIFICATION_MODE',
    subject: 'AUTH_EMAIL_VERIFICATION_SUBJECT',
    from: 'AUTH_EMAIL_VERIFICATION_EMAIL_FROM',
    defaultSubject: 'Verify your AgentifUI email address',
    description: 'Please verify your email address for your AgentifUI account.',
    action: 'Verify email address',
    disclaimer: 'If you did not create this account, please ignore this email.',
  },
} as const;

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function isSmtpEnabled(modeSetting: string): boolean {
  const raw = process.env[modeSetting]?.trim().toLowerCase();
  if (raw === 'smtp') {
    return true;
  }
  if (raw && raw !== 'dev-log') {
    throw new Error(`Unsupported ${modeSetting}; use dev-log or smtp`);
  }
  return false;
}

function getSmtpConfig() {
  const host = process.env.SMTP_HOST?.trim();
  if (!host) {
    throw new Error(
      'SMTP_HOST is required when authentication email uses smtp'
    );
  }
  const port = Number(process.env.SMTP_PORT || 587);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP_PORT must be an integer between 1 and 65535');
  }
  const secureSetting = process.env.SMTP_SECURE?.trim().toLowerCase();
  if (
    secureSetting &&
    !['1', 'true', 'yes', 'on', '0', 'false', 'no', 'off'].includes(
      secureSetting
    )
  ) {
    throw new Error('SMTP_SECURE must be a boolean');
  }
  const secure = secureSetting
    ? ['1', 'true', 'yes', 'on'].includes(secureSetting)
    : port === 465;
  const user = process.env.SMTP_USER?.trim();
  return {
    host,
    port,
    secure,
    requireTLS: !secure,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 30000,
    auth: user
      ? { user, pass: process.env.SMTP_PASSWORD?.trim() || '' }
      : undefined,
  };
}

interface AuthEmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

async function getSmtpTransporter() {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const existing = globalState[SMTP_TRANSPORTER_KEY];
  if (existing) {
    return existing as {
      sendMail: (message: AuthEmailMessage) => Promise<unknown>;
    };
  }
  const nodemailerModule = await import('nodemailer');
  const transporter = nodemailerModule.createTransport(getSmtpConfig());
  globalState[SMTP_TRANSPORTER_KEY] = transporter;
  return transporter;
}

async function sendAuthEmail(kind: AuthEmailKind, payload: AuthEmailPayload) {
  if (process.env.AUTH_EMAIL_DISABLED === '1') {
    throw new Error('Authentication email is disabled on this deployment');
  }
  const email = payload.user.email?.trim().toLowerCase();
  if (!email) {
    throw new Error(
      'An email address is required to send authentication email'
    );
  }
  const settings = EMAIL_SETTINGS[kind];
  if (!isSmtpEnabled(settings.mode)) {
    console.info(
      `[better-auth] ${kind} requested (dev-log mode):`,
      JSON.stringify({ email, url: payload.url, token: payload.token }, null, 2)
    );
    return;
  }
  const displayName = payload.user.name?.trim() || 'there';
  const transporter = await getSmtpTransporter();
  if (!(await reserveAuthEmail(email, kind))) {
    return;
  }
  await transporter.sendMail({
    from:
      process.env[settings.from]?.trim() ||
      process.env.SMTP_FROM?.trim() ||
      'AgentifUI <no-reply@localhost>',
    to: email,
    subject: process.env[settings.subject]?.trim() || settings.defaultSubject,
    text: [
      `Hello ${displayName},`,
      '',
      settings.description,
      `${settings.action}:`,
      payload.url,
      '',
      settings.disclaimer,
    ].join('\n'),
    html: [
      `<p>Hello ${escapeHtml(displayName)},</p>`,
      `<p>${settings.description}</p>`,
      `<p><a href="${escapeHtml(payload.url)}">${settings.action}</a></p>`,
      `<p>${settings.disclaimer}</p>`,
    ].join(''),
  });
}

export async function sendVerificationEmail(payload: AuthEmailPayload) {
  await sendAuthEmail('verification', payload);
}

export async function sendResetPasswordEmail(payload: AuthEmailPayload) {
  await sendAuthEmail('password-reset', payload);
}
