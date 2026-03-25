import {
  type AccountStatus,
  type AppVisibility,
  type ExecutionStatus,
  type ExecutionType,
  type InternalActionRequest,
  LOCAL_ACCOUNT_STATUSES,
  LOCAL_APP_VISIBILITIES,
  LOCAL_EXECUTION_STATUSES,
  LOCAL_MESSAGE_STATUSES,
  LOCAL_SSO_PROTOCOLS,
  LOCAL_USER_ROLES,
  type MessageRole,
  type MessageStatus,
  type SsoProtocol,
  type UserRole,
} from '../types';

export function readString(value: unknown): string {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
}

export function parsePositiveInt(input: unknown, fallback: number): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(0, Math.floor(parsed));
}

export function parseMessageStatus(value: unknown): MessageStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as MessageStatus;
  if (!LOCAL_MESSAGE_STATUSES.has(normalized)) {
    return null;
  }
  return normalized;
}

export function parseMessageRole(value: unknown): MessageRole | null {
  if (value === 'user' || value === 'assistant' || value === 'system') {
    return value;
  }
  return null;
}

export function parseExecutionType(value: unknown): ExecutionType | null {
  if (value === 'workflow' || value === 'text-generation') {
    return value;
  }
  return null;
}

export function parseExecutionStatus(value: unknown): ExecutionStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as ExecutionStatus;
  if (!LOCAL_EXECUTION_STATUSES.has(normalized)) {
    return null;
  }
  return normalized;
}

export function parseUserRole(value: unknown): UserRole | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as UserRole;
  if (!LOCAL_USER_ROLES.has(normalized)) {
    return null;
  }
  return normalized;
}

export function parseAccountStatus(value: unknown): AccountStatus | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as AccountStatus;
  if (!LOCAL_ACCOUNT_STATUSES.has(normalized)) {
    return null;
  }
  return normalized;
}

export function parseAppVisibility(value: unknown): AppVisibility | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as AppVisibility;
  if (!LOCAL_APP_VISIBILITIES.has(normalized)) {
    return null;
  }
  return normalized;
}

export function parseSsoProtocol(value: unknown): SsoProtocol | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim() as SsoProtocol;
  if (!LOCAL_SSO_PROTOCOLS.has(normalized)) {
    return null;
  }
  return normalized;
}

export function readBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return fallback;
}

export function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean);
}

export function readObject(
  value: unknown,
  fallback: Record<string, unknown> = {}
): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fallback;
  }
  return value as Record<string, unknown>;
}

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

export function resolvePayloadUserId(
  payload: Record<string, unknown> | undefined
): string {
  if (!payload) {
    return '';
  }
  return readString(payload.userId);
}

export function normalizeRequestBody(body: unknown): InternalActionRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {};
  }

  return body as InternalActionRequest;
}

export function normalizePayload(
  body: InternalActionRequest
): Record<string, unknown> | undefined {
  const payload = body.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return undefined;
  }
  return payload;
}

export function normalizeNullableTextValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}
