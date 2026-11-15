/** @jest-environment node */
import {
  readHumanInputState,
  requireHumanInputCapabilities,
} from './human-input';
import { nativeJSON } from './transport';

jest.mock('./transport', () => ({ nativeJSON: jest.fn() }));

function paused() {
  return {
    values: { outcome: 'pending', effect_count: 0 },
    next: ['await_decision'],
    checkpoint: { checkpoint_id: 'private-checkpoint' },
    tasks: [
      {
        interrupts: [
          {
            id: 'private-interrupt',
            value: {
              kind: 'agentifui.acceptance.confirmation',
              version: 1,
              task_id: 'private-task',
              title: 'Confirm',
              description: 'Synthetic task',
              actions: ['approve', 'reject'],
              comment_max_length: 500,
              expires_at: null,
              private_field: 'must-not-be-public',
            },
          },
        ],
      },
    ],
  };
}

it('reads tasks[].interrupts without requiring a top-level interrupts field and whitelists the prompt', () => {
  const state = readHumanInputState(paused());
  expect(state.interrupt).toMatchObject({
    id: 'private-interrupt',
    prompt: {
      title: 'Confirm',
      description: 'Synthetic task',
      actions: ['approve', 'reject'],
      commentMaxLength: 500,
      expiresAt: null,
    },
  });
  expect(JSON.stringify(state.interrupt?.prompt)).not.toMatch(
    /private|task_id/
  );
});

it('rejects multiple interrupts rather than silently answering a subset', () => {
  const state = paused();
  state.tasks.push(state.tasks[0]);
  expect(() => readHumanInputState(state)).toThrow('UPSTREAM_PROTOCOL_ERROR');
});

it.each(['invalid', '2026-99-99T00:00:00Z', 123])(
  'rejects an unparseable expiry %s',
  expiry => {
    const state = paused();
    Object.assign(state.tasks[0].interrupts[0].value, { expires_at: expiry });
    expect(() => readHumanInputState(state)).toThrow('UPSTREAM_PROTOCOL_ERROR');
  }
);

it('does not infer waiting from an outcome without a real task interrupt', () => {
  const state = paused();
  state.tasks = [];
  expect(readHumanInputState(state).interrupt).toBeUndefined();
});

it('requires a consistent final decision and final visible assistant message', () => {
  const final = {
    values: {
      outcome: 'rejected',
      decision: { action: 'reject', comment: '' },
      effect_count: 0,
      messages: [
        { type: 'human', content: 'question' },
        { type: 'ai', id: 'native-final', content: 'Not executed.' },
      ],
    },
    tasks: [],
    next: [],
  };
  expect(readHumanInputState(final)).toMatchObject({
    outcome: 'rejected',
    messages: [{ content: 'Not executed.' }],
  });
  final.values.decision.action = 'approve';
  expect(() => readHumanInputState(final)).toThrow('UPSTREAM_PROTOCOL_ERROR');
});

it('discovers the explicitly configured graph without hardcoding a graph name', async () => {
  jest.mocked(nativeJSON).mockResolvedValue({
    agents: [
      {
        assistant_id: 'custom-approval',
        features: ['native_interrupt', 'native_resume'],
        actions: ['approve', 'reject'],
        one_task_per_thread: true,
      },
    ],
  });
  await expect(
    requireHumanInputCapabilities({
      baseUrl: 'https://example.invalid',
      apiKey: 'synthetic',
      assistantId: 'custom-approval',
    })
  ).resolves.toBeUndefined();
  await expect(
    requireHumanInputCapabilities({
      baseUrl: 'https://example.invalid',
      apiKey: 'synthetic',
      assistantId: 'ordinary',
    })
  ).rejects.toThrow('UPSTREAM_PROTOCOL_ERROR');
});
