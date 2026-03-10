export type AgentErrorSource =
  | 'dify-workflow'
  | 'dify-completion'
  | 'dify-chat'
  | 'dify-proxy'
  | 'agent-generic';

type AgentErrorKind =
  | 'input_invalid'
  | 'tool_runtime_failure'
  | 'upstream_unavailable'
  | 'quota_exceeded'
  | 'auth_failed'
  | 'unknown';

export interface AgentErrorContext {
  source?: AgentErrorSource;
  message?: string | null;
  status?: number;
  code?: string | null;
  locale?: string;
}

export interface UserFacingAgentError {
  code: string;
  kind: AgentErrorKind;
  source: AgentErrorSource;
  retryable: boolean;
  userMessage: string;
  suggestion: string;
  rawMessage: string | null;
}

const INPUT_PATTERN =
  /(cannot read properties of undefined.*split|undefined.*split|invalid param|invalid parameter|missing required)/i;
const TOOL_RUNTIME_PATTERN =
  /(failed to invoke tool|plugininvokeerror|command '\\[.*npm.*install.*\\]'|tool runtime|tool execution)/i;
const UPSTREAM_UNAVAILABLE_PATTERN =
  /(fetch failed|econnreset|etimedout|eai_again|timeout|timed out|network error|connection refused|aborted|temporary unavailable)/i;
const QUOTA_PATTERN =
  /(quota|rate limit|provider_quota_exceeded|too many requests|429)/i;
const AUTH_PATTERN =
  /(unauthorized|forbidden|invalid api key|invalid token|auth failed|permission denied|401|403)/i;

function isZhLocale(locale?: string): boolean {
  if (!locale) {
    return false;
  }

  return locale.toLowerCase().startsWith('zh');
}

function normalizeRawMessage(message?: string | null): string | null {
  if (!message) {
    return null;
  }

  const trimmed = message.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveErrorSource(source?: AgentErrorSource): AgentErrorSource {
  return source || 'agent-generic';
}

function resolveMessages(
  kind: AgentErrorKind,
  useZh: boolean
): {
  code: string;
  userMessage: string;
  suggestion: string;
  retryable: boolean;
} {
  if (useZh) {
    switch (kind) {
      case 'input_invalid':
        return {
          code: 'AGENT_INPUT_INVALID',
          retryable: true,
          userMessage:
            '执行失败：输入参数格式不符合工作流节点要求。请检查字段映射后重试。',
          suggestion:
            '检查表单变量名与工作流变量名是否一致（例如 URL/url），并确认参数不为空。',
        };
      case 'tool_runtime_failure':
        return {
          code: 'AGENT_TOOL_RUNTIME_FAILURE',
          retryable: false,
          userMessage:
            '执行失败：工作流工具节点运行异常，请联系管理员处理工具运行环境。',
          suggestion:
            '重点检查工具依赖安装、运行沙箱、外部命令权限与网络连通性。',
        };
      case 'upstream_unavailable':
        return {
          code: 'AGENT_UPSTREAM_UNAVAILABLE',
          retryable: true,
          userMessage: '执行失败：上游 Agent 服务暂时不可用，请稍后重试。',
          suggestion: '可先重试；若持续失败，请检查上游服务状态与网络配置。',
        };
      case 'quota_exceeded':
        return {
          code: 'AGENT_QUOTA_EXCEEDED',
          retryable: false,
          userMessage: '执行失败：上游模型或工具配额已用尽。',
          suggestion: '请联系管理员扩容配额、切换模型或更换可用提供商。',
        };
      case 'auth_failed':
        return {
          code: 'AGENT_AUTH_FAILED',
          retryable: false,
          userMessage: '执行失败：上游服务鉴权失败，请检查凭据配置。',
          suggestion: '请校验 API Key、租户权限与对应实例绑定关系。',
        };
      default:
        return {
          code: 'AGENT_UNKNOWN_ERROR',
          retryable: true,
          userMessage: '执行失败：服务返回了未识别错误，请稍后重试。',
          suggestion: '如果问题持续，请将错误详情提供给管理员排查。',
        };
    }
  }

  switch (kind) {
    case 'input_invalid':
      return {
        code: 'AGENT_INPUT_INVALID',
        retryable: true,
        userMessage:
          'Execution failed: input parameters do not match workflow node requirements.',
        suggestion:
          'Verify field mappings (for example URL/url) and ensure required values are present.',
      };
    case 'tool_runtime_failure':
      return {
        code: 'AGENT_TOOL_RUNTIME_FAILURE',
        retryable: false,
        userMessage:
          'Execution failed: workflow tool runtime failed. Please contact an administrator.',
        suggestion:
          'Check tool dependencies, sandbox runtime, command permissions, and outbound network access.',
      };
    case 'upstream_unavailable':
      return {
        code: 'AGENT_UPSTREAM_UNAVAILABLE',
        retryable: true,
        userMessage:
          'Execution failed: upstream agent service is temporarily unavailable.',
        suggestion:
          'Retry shortly; if it persists, verify upstream service health and network connectivity.',
      };
    case 'quota_exceeded':
      return {
        code: 'AGENT_QUOTA_EXCEEDED',
        retryable: false,
        userMessage:
          'Execution failed: upstream model or tool quota has been exceeded.',
        suggestion:
          'Increase quota, switch model, or route to another available provider.',
      };
    case 'auth_failed':
      return {
        code: 'AGENT_AUTH_FAILED',
        retryable: false,
        userMessage:
          'Execution failed: upstream authentication failed. Please check credentials.',
        suggestion:
          'Validate API key, tenant permissions, and app-instance credential bindings.',
      };
    default:
      return {
        code: 'AGENT_UNKNOWN_ERROR',
        retryable: true,
        userMessage:
          'Execution failed: an unclassified upstream error occurred. Please retry later.',
        suggestion:
          'If this keeps happening, capture the raw error and contact an administrator.',
      };
  }
}

function classifyErrorKind(
  rawMessage: string | null,
  status?: number,
  code?: string | null
): AgentErrorKind {
  const message = rawMessage || '';
  const normalizedCode = (code || '').toLowerCase();

  if (
    status === 401 ||
    status === 403 ||
    normalizedCode.includes('unauthorized') ||
    normalizedCode.includes('forbidden') ||
    AUTH_PATTERN.test(message)
  ) {
    return 'auth_failed';
  }

  if (
    status === 429 ||
    normalizedCode.includes('quota') ||
    normalizedCode.includes('rate_limit') ||
    QUOTA_PATTERN.test(message)
  ) {
    return 'quota_exceeded';
  }

  if (TOOL_RUNTIME_PATTERN.test(message)) {
    return 'tool_runtime_failure';
  }

  if (INPUT_PATTERN.test(message)) {
    return 'input_invalid';
  }

  if (
    status === 502 ||
    status === 503 ||
    status === 504 ||
    UPSTREAM_UNAVAILABLE_PATTERN.test(message)
  ) {
    return 'upstream_unavailable';
  }

  return 'unknown';
}

export function toUserFacingAgentError(
  context: AgentErrorContext
): UserFacingAgentError {
  const source = resolveErrorSource(context.source);
  const rawMessage = normalizeRawMessage(context.message);
  const kind = classifyErrorKind(rawMessage, context.status, context.code);
  const localized = resolveMessages(kind, isZhLocale(context.locale));

  return {
    source,
    kind,
    code: localized.code,
    retryable: localized.retryable,
    userMessage: localized.userMessage,
    suggestion: localized.suggestion,
    rawMessage,
  };
}
