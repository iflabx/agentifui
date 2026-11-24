import type { Event } from '@agentifui/shared';

import type { AgentApp } from '../agent-app';
import { LANGCHAIN_CAPABILITIES } from '../agent-backends';
import type { AgentInputFileReference } from '../agent-input-file-repository';
import { PHASE4_RESULT_PROFILE } from '../agent-result';
import { executeAgentRun } from '../agent-run-execution';
import type { AgentRunRecord } from '../agent-runs-repository';
import { langChainInputPath } from '../langchain/input-profile';
import { executeDifyAgentRun } from './dify-execution';
import type { DifyChatInputs, DifyInputFile } from './dify-transport';

export function describeNegotiatedRuntime(app: AgentApp) {
  const acceptsInputCapabilities =
    app.backendType === 'dify'
      ? app.interactionProtocol === 'ag-ui/1.0'
      : Boolean(langChainInputPath(app.assistantId));
  return {
    protocol: 'ag-ui/1.0',
    persistence: 'server',
    acceptsInputCapabilities,
    ...(app.humanInput ? { singleTask: true } : {}),
    newConversationsEnabled:
      app.backendType !== 'dify' || app.interactionProtocol === 'ag-ui/1.0',
    ...(app.backendType === 'dify'
      ? {
          interactionMode: acceptsInputCapabilities
            ? 'configured'
            : 'text-only',
        }
      : {}),
    ...(app.backendType === 'dify'
      ? { profile: 'chatbot', modeVerification: 'per-run' }
      : {}),
    capabilities:
      app.backendType === 'dify'
        ? { ...LANGCHAIN_CAPABILITIES, tools: false, runQuery: false }
        : {
            ...LANGCHAIN_CAPABILITIES,
            humanInput: app.humanInput === true,
            ...(app.resultProfileEnabled === true
              ? {
                  resultArtifacts: {
                    profile: PHASE4_RESULT_PROFILE,
                    formats: ['text/markdown', 'text/csv'],
                    batchesPerThread: 1,
                  },
                }
              : {}),
          },
  };
}

export async function executeNegotiatedAgentRun(input: {
  rootTaskId: string;
  app: AgentApp;
  run: AgentRunRecord;
  content: string;
  inputs: DifyChatInputs;
  files?: DifyInputFile[];
  inputFiles?: AgentInputFileReference[];
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
