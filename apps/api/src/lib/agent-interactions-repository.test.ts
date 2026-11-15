/** @jest-environment node */
import {
  type AgentInteractionRecord,
  publicAgentInteraction,
  validateInteractionDecision,
} from './agent-interactions-repository';

const prompt = {
  title: 'Confirmation',
  description: 'Synthetic only',
  actions: ['approve', 'reject'] as ('approve' | 'reject')[],
  commentMaxLength: 5,
  expiresAt: null,
};
const submissionId = '10000000-0000-4000-8000-000000000001';

it('normalizes an omitted comment and rejects extras, native controls, invalid IDs and invalid decisions', () => {
  expect(
    validateInteractionDecision({ submissionId, action: 'approve' }, prompt)
  ).toEqual({ submissionId, action: 'approve', comment: '' });
  for (const body of [
    null,
    [],
    { submissionId, action: 'other' },
    { submissionId, action: 'approve', comment: 1 },
    { submissionId, action: 'approve', comment: '123456' },
    { submissionId, action: 'approve', input: {} },
    { submissionId, action: 'approve', checkpoint: 'private' },
    { submissionId: 'native-id', action: 'reject' },
  ])
    expect(() => validateInteractionDecision(body, prompt)).toThrow();
});

it('counts Unicode characters consistently with the native decision validator', () => {
  expect(
    validateInteractionDecision(
      { submissionId, action: 'reject', comment: '\u{1F600}'.repeat(5) },
      prompt
    ).comment
  ).toHaveLength(10);
});

it('only exposes local IDs and public fields, including the accepted decision and resume run', () => {
  const value = publicAgentInteraction({
    id: submissionId,
    origin_run_id: submissionId,
    native_interrupt_id: 'private-interrupt',
    checkpoint: { private_checkpoint: true },
    prompt,
    status: 'accepted',
    expires_at: null,
    submission_id: submissionId,
    request_hash: 'private-hash',
    decision: { action: 'reject', comment: '' },
    resume_run_id: submissionId,
  } as AgentInteractionRecord);
  expect(value).toEqual({
    id: submissionId,
    originRunId: submissionId,
    status: 'accepted',
    ...prompt,
    decision: { action: 'reject', comment: '' },
    resumeRunId: submissionId,
  });
  expect(JSON.stringify(value)).not.toMatch(
    /private|native|checkpoint|request_hash/
  );
});
