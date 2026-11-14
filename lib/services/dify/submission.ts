export interface DifySubmissionOptions {
  submissionId?: string;
}

export function difySubmissionHeaders(options?: DifySubmissionOptions) {
  return {
    'Content-Type': 'application/json',
    'x-agentifui-submission-id': options?.submissionId ?? crypto.randomUUID(),
  };
}
