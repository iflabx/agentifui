import { SYSTEM_POLICY_CONTEXT, queryRowsWithPolicyContext } from './context';
import { normalizeEmail } from './helpers';
import type { LocalLoginAuditInput, LocalLoginPolicyContext } from './types';

export async function recordLocalLoginAudit(
  input: LocalLoginAuditInput,
  context: LocalLoginPolicyContext = SYSTEM_POLICY_CONTEXT
): Promise<void> {
  try {
    await queryRowsWithPolicyContext(
      `
      INSERT INTO auth_local_login_audit_logs (
        user_id,
        email,
        auth_mode,
        outcome,
        reason,
        status_code,
        ip_address,
        user_agent
      ) VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id::text
      `,
      [
        input.userId || null,
        normalizeEmail(input.email),
        input.authMode,
        input.outcome,
        input.reason || null,
        input.statusCode ?? null,
        input.ipAddress || null,
        input.userAgent || null,
      ],
      context
    );
  } catch (error) {
    console.warn('[AuthLocalLoginPolicy] failed to insert local-login audit:', {
      error,
      input,
    });
  }
}
