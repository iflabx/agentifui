import type { PhoneNumberOptions } from 'better-auth/plugins/phone-number';

type PhoneOtpPurpose = 'verify' | 'password-reset';
type PhoneOtpMode = 'dev-log' | 'http';

function parseNumber(
  value: string | undefined,
  fallback: number,
  min: number
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min) {
    return fallback;
  }
  return Math.floor(parsed);
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

function getPhoneOtpMode(): PhoneOtpMode {
  const raw = process.env.AUTH_PHONE_OTP_MODE?.trim().toLowerCase();
  if (raw === 'http') {
    return 'http';
  }

  if (raw && raw !== 'dev-log') {
    console.warn(
      `[better-auth] unsupported AUTH_PHONE_OTP_MODE="${raw}", fallback to dev-log`
    );
  }

  return 'dev-log';
}

function normalizePhoneForEmail(phoneNumber: string): string {
  const digits = phoneNumber.replace(/\D+/g, '');
  return digits.length > 0 ? digits : 'unknown';
}

function getPhoneTempEmailDomain(): string {
  const configured = process.env.AUTH_PHONE_TEMP_EMAIL_DOMAIN?.trim();
  if (!configured) {
    return 'phone.local';
  }

  return configured.replace(/^@+/, '');
}

function isValidE164(phoneNumber: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(phoneNumber.trim());
}

async function postPhoneOtpWebhook(payload: {
  phoneNumber: string;
  code: string;
  purpose: PhoneOtpPurpose;
}) {
  const endpoint = process.env.AUTH_PHONE_OTP_API_URL?.trim();
  if (!endpoint) {
    throw new Error('AUTH_PHONE_OTP_API_URL is required for http OTP mode');
  }

  const timeoutMs = parseNumber(
    process.env.AUTH_PHONE_OTP_HTTP_TIMEOUT_MS,
    8000,
    1
  );
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const token = process.env.AUTH_PHONE_OTP_API_TOKEN?.trim();
  const tokenHeader =
    process.env.AUTH_PHONE_OTP_API_TOKEN_HEADER?.trim() || 'authorization';

  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  if (token) {
    headers[tokenHeader] =
      tokenHeader.toLowerCase() === 'authorization' ? `Bearer ${token}` : token;
  }

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        ...payload,
        provider: 'better-auth',
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`OTP webhook responded with HTTP ${response.status}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

async function deliverPhoneOtp(
  payload: {
    phoneNumber: string;
    code: string;
  },
  purpose: PhoneOtpPurpose
) {
  const mode = getPhoneOtpMode();
  if (mode === 'http') {
    await postPhoneOtpWebhook({
      ...payload,
      purpose,
    });
    return;
  }

  console.info(
    '[better-auth] phone otp generated (dev-log mode):',
    JSON.stringify(
      {
        phoneNumber: payload.phoneNumber,
        code: payload.code,
        purpose,
      },
      null,
      2
    )
  );
}

export function getPhoneNumberPluginOptions(): PhoneNumberOptions {
  const otpLength = parseNumber(process.env.AUTH_PHONE_OTP_LENGTH, 6, 4);
  const expiresIn = parseNumber(process.env.AUTH_PHONE_OTP_EXPIRES_IN, 300, 30);
  const allowedAttempts = parseNumber(
    process.env.AUTH_PHONE_OTP_ALLOWED_ATTEMPTS,
    3,
    1
  );
  const signUpOnVerification = parseBoolean(
    process.env.AUTH_PHONE_SIGNUP_ON_VERIFICATION,
    true
  );

  const options: PhoneNumberOptions = {
    otpLength,
    expiresIn,
    allowedAttempts,
    sendOTP: payload => deliverPhoneOtp(payload, 'verify'),
    sendPasswordResetOTP: payload => deliverPhoneOtp(payload, 'password-reset'),
    phoneNumberValidator: async phoneNumber => isValidE164(phoneNumber),
    schema: {
      user: {
        fields: {
          phoneNumber: 'phone_number',
          phoneNumberVerified: 'phone_number_verified',
        },
      },
    },
  };

  if (signUpOnVerification) {
    const domain = getPhoneTempEmailDomain();
    options.signUpOnVerification = {
      getTempEmail: phoneNumber =>
        `phone-${normalizePhoneForEmail(phoneNumber)}@${domain}`,
      getTempName: phoneNumber =>
        `phone-${normalizePhoneForEmail(phoneNumber)}`,
    };
  }

  return options;
}
