import { LangChainUpstreamError, isLangChainId } from './ag-ui';
import { type LangChainConfig, nativeJSON } from './transport';

export interface HumanInputPrompt {
  title: string;
  description: string;
  actions: ('approve' | 'reject')[];
  commentMaxLength: number;
  expiresAt: string | null;
}

export interface HumanInputDecision {
  action: 'approve' | 'reject';
  comment: string;
}

export interface NativeHumanInputState {
  interrupt?: {
    id: string;
    prompt: HumanInputPrompt;
    checkpoint: Record<string, unknown>;
  };
  outcome: 'pending' | 'approved' | 'rejected' | undefined;
  decision?: HumanInputDecision;
  messages: { id: string; content: string }[];
}

function invalid(): never {
  throw new LangChainUpstreamError('UPSTREAM_PROTOCOL_ERROR');
}

export function nativeObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}

export function readHumanInputState(value: unknown): NativeHumanInputState {
  const state = nativeObject(value);
  const values = nativeObject(state.values);
  if (!Array.isArray(state.tasks) || !Array.isArray(state.next)) invalid();
  const interrupts = state.tasks.flatMap(task => {
    const item = nativeObject(task);
    if (item.interrupts === undefined) return [];
    if (!Array.isArray(item.interrupts)) invalid();
    return item.interrupts;
  });
  if (interrupts.length > 1) invalid();
  const outcome = values.outcome;
  if (
    outcome !== undefined &&
    !['pending', 'approved', 'rejected'].includes(String(outcome))
  )
    invalid();
  const result: NativeHumanInputState = {
    outcome: outcome as NativeHumanInputState['outcome'],
    messages: [],
  };
  if (interrupts.length) {
    const interrupt = nativeObject(interrupts[0]);
    const prompt = nativeObject(interrupt.value);
    const checkpoint = nativeObject(state.checkpoint);
    if (
      !isLangChainId(interrupt.id) ||
      !isLangChainId(checkpoint.checkpoint_id) ||
      outcome !== 'pending' ||
      state.next.length === 0 ||
      values.effect_count !== 0 ||
      prompt.kind !== 'agentifui.acceptance.confirmation' ||
      prompt.version !== 1 ||
      typeof prompt.title !== 'string' ||
      !prompt.title.trim() ||
      prompt.title.length > 500 ||
      typeof prompt.description !== 'string' ||
      prompt.description.length > 16000 ||
      !Array.isArray(prompt.actions) ||
      prompt.actions.length !== 2 ||
      !prompt.actions.includes('approve') ||
      !prompt.actions.includes('reject') ||
      !Number.isInteger(prompt.comment_max_length) ||
      Number(prompt.comment_max_length) < 0 ||
      Number(prompt.comment_max_length) > 500 ||
      (prompt.expires_at !== null &&
        (typeof prompt.expires_at !== 'string' ||
          !/^\d{4}-\d\d-\d\dT/.test(prompt.expires_at) ||
          !Number.isFinite(Date.parse(prompt.expires_at))))
    )
      invalid();
    result.interrupt = {
      id: interrupt.id,
      checkpoint,
      prompt: {
        title: prompt.title,
        description: prompt.description,
        actions: ['approve', 'reject'],
        commentMaxLength: Number(prompt.comment_max_length),
        expiresAt: prompt.expires_at as string | null,
      },
    };
  }
  if (outcome === 'approved' || outcome === 'rejected') {
    if (interrupts.length || state.next.length) invalid();
    const decision = nativeObject(values.decision);
    if (
      decision.action !== (outcome === 'approved' ? 'approve' : 'reject') ||
      typeof decision.comment !== 'string' ||
      [...decision.comment].length > 500 ||
      values.effect_count !== (outcome === 'approved' ? 1 : 0)
    )
      invalid();
    result.decision = {
      action: outcome === 'approved' ? 'approve' : 'reject',
      comment: decision.comment,
    };
    if (!Array.isArray(values.messages)) invalid();
    result.messages = values.messages.flatMap(message => {
      const item = nativeObject(message);
      if (item.type !== 'ai' && item.role !== 'assistant') return [];
      if (
        !isLangChainId(item.id) ||
        typeof item.content !== 'string' ||
        Buffer.byteLength(item.content, 'utf8') > 64 * 1024
      )
        invalid();
      return [{ id: item.id, content: item.content }];
    });
    if (!result.messages.length || result.messages.length > 64) invalid();
  }
  return result;
}

export async function getHumanInputState(
  config: LangChainConfig,
  threadId: string
) {
  if (!isLangChainId(threadId)) invalid();
  return readHumanInputState(
    await nativeJSON(config, `/threads/${encodeURIComponent(threadId)}/state`)
  );
}

export async function requireHumanInputCapabilities(config: LangChainConfig) {
  const capabilities = nativeObject(await nativeJSON(config, '/capabilities'));
  if (!Array.isArray(capabilities.agents)) invalid();
  const agent = capabilities.agents
    .map(nativeObject)
    .find(item => item.assistant_id === config.assistantId);
  if (
    !agent ||
    !Array.isArray(agent.features) ||
    !agent.features.includes('native_interrupt') ||
    !agent.features.includes('native_resume') ||
    agent.one_task_per_thread !== true ||
    !Array.isArray(agent.actions) ||
    !agent.actions.includes('approve') ||
    !agent.actions.includes('reject')
  )
    invalid();
}

export async function findHumanInputRun(
  config: LangChainConfig,
  threadId: string,
  runId: string
): Promise<string | undefined> {
  const runs = await nativeJSON(
    config,
    `/threads/${encodeURIComponent(threadId)}/runs?limit=100`
  );
  if (!Array.isArray(runs)) invalid();
  const matching = runs
    .map(nativeObject)
    .filter(run => nativeObject(run.metadata ?? {}).agentifui_run_id === runId);
  if (matching.length > 1) invalid();
  if (!matching.length) return undefined;
  if (!isLangChainId(matching[0].run_id) || matching[0].thread_id !== threadId)
    invalid();
  return matching[0].run_id;
}
