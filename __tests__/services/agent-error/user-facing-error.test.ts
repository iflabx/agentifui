import { toUserFacingAgentError } from '@lib/services/agent-error/user-facing-error';

describe('toUserFacingAgentError', () => {
  it('classifies input validation error and returns zh friendly message', () => {
    const result = toUserFacingAgentError({
      source: 'dify-workflow',
      message: "Cannot read properties of undefined (reading 'split')",
      locale: 'zh-CN',
    });

    expect(result.kind).toBe('input_invalid');
    expect(result.code).toBe('AGENT_INPUT_INVALID');
    expect(result.retryable).toBe(true);
    expect(result.userMessage).toContain('输入参数格式不符合');
  });

  it('classifies tool runtime failure based on message pattern', () => {
    const result = toUserFacingAgentError({
      source: 'dify-workflow',
      message:
        "Failed to invoke tool webscraper: Command '['npm', 'install']' returned non-zero exit status 1.",
      locale: 'en-US',
    });

    expect(result.kind).toBe('tool_runtime_failure');
    expect(result.code).toBe('AGENT_TOOL_RUNTIME_FAILURE');
    expect(result.retryable).toBe(false);
  });

  it('classifies upstream unavailable based on status code', () => {
    const result = toUserFacingAgentError({
      source: 'dify-chat',
      message: 'unknown transport failure',
      status: 503,
      locale: 'en-US',
    });

    expect(result.kind).toBe('upstream_unavailable');
    expect(result.code).toBe('AGENT_UPSTREAM_UNAVAILABLE');
    expect(result.retryable).toBe(true);
  });

  it('classifies auth failures by status/code', () => {
    const result = toUserFacingAgentError({
      source: 'dify-completion',
      message: 'provider says forbidden',
      status: 403,
      code: 'forbidden',
      locale: 'en-US',
    });

    expect(result.kind).toBe('auth_failed');
    expect(result.code).toBe('AGENT_AUTH_FAILED');
    expect(result.retryable).toBe(false);
  });

  it('classifies quota exceeded and preserves raw message', () => {
    const result = toUserFacingAgentError({
      source: 'dify-completion',
      message: 'rate limit reached: too many requests',
      locale: 'zh-CN',
    });

    expect(result.kind).toBe('quota_exceeded');
    expect(result.code).toBe('AGENT_QUOTA_EXCEEDED');
    expect(result.rawMessage).toContain('rate limit');
  });

  it('falls back to unknown when no signal exists', () => {
    const result = toUserFacingAgentError({
      message: 'some random provider failure',
      locale: 'en-US',
    });

    expect(result.source).toBe('agent-generic');
    expect(result.kind).toBe('unknown');
    expect(result.code).toBe('AGENT_UNKNOWN_ERROR');
    expect(result.retryable).toBe(true);
  });
});
