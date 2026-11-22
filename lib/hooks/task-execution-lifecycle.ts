import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';

export function taskExecutionIsCurrent(
  signal: AbortSignal,
  actorId: string,
  actorEpoch: number,
  executionId: string | null
): boolean {
  const actor = useChatInputStore.getState();
  return (
    !signal.aborted &&
    actor.actorId === actorId &&
    actor.actorEpoch === actorEpoch &&
    (!executionId ||
      useWorkflowExecutionStore.getState().currentExecution?.id === executionId)
  );
}
