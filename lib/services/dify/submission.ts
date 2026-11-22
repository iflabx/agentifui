export interface DifySubmissionOptions {
  submissionId?: string;
}

export function definitiveTaskError(
  error: Error,
  outcome: 'refused' | 'failed'
): Error {
  return Object.assign(error, { taskOutcome: outcome });
}

export function hasDefinitiveTaskOutcome(error: unknown): boolean {
  return (
    error instanceof Error &&
    'taskOutcome' in error &&
    (error.taskOutcome === 'refused' || error.taskOutcome === 'failed')
  );
}

export function difySubmissionHeaders(options?: DifySubmissionOptions) {
  return {
    'Content-Type': 'application/json',
    'x-agentifui-submission-id': options?.submissionId ?? crypto.randomUUID(),
  };
}
