import type { Event } from '@agentifui/shared';

import type { AgentApp } from '../agent-app';
import { LANGCHAIN_CAPABILITIES } from '../agent-backends';
import { executeAgentRun } from '../agent-run-execution';
import type { AgentRunRecord } from '../agent-runs-repository';
import { executeDifyAgentRun } from './dify-execution';

export function describeNegotiatedRuntime(app: AgentApp) {
  return {
    protocol: 'ag-ui/1.0',
    persistence: 'server',
    newConversationsEnabled:
      app.backendType !== 'dify' || app.interactionProtocol === 'ag-ui/1.0',
    ...(app.backendType === 'dify' ? { interactionMode: 'text-only' } : {}),
    ...(app.backendType === 'dify'
      ? { profile: 'chatbot', modeVerification: 'per-run' }
      : {}),
    capabilities:
      app.backendType === 'dify'
        ? { ...LANGCHAIN_CAPABILITIES, tools: false, runQuery: false }
        : LANGCHAIN_CAPABILITIES,
  };
}

export async function executeNegotiatedAgentRun(input: {
  rootTaskId: string;
  app: AgentApp;
  run: AgentRunRecord;
  content: string;
  inputs: Record<string, string>;
  emit: (event: Event) => void;
  report: (context: { runId: string; code: string }) => void;
}): Promise<void> {
  if (input.app.backendType === 'dify') return executeDifyAgentRun(input);
  return executeAgentRun({
    ...input,
    emit: () => undefined,
    agui: { emit: input.emit },
  });
}
