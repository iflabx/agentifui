import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';
import type { AppExecution } from '@lib/types/database';

import { taskExecutionIsCurrent } from './task-execution-lifecycle';

test('late task writes are rejected after navigation, actor replacement or cancellation', () => {
  const originalActor = useChatInputStore.getState();
  const originalWorkflow = useWorkflowExecutionStore.getState();
  try {
    useChatInputStore.setState({ actorId: 'actor', actorEpoch: 10 });
    useWorkflowExecutionStore.setState({
      currentExecution: { id: 'run-a' } as AppExecution,
    });
    const controller = new AbortController();
    const current = () =>
      taskExecutionIsCurrent(controller.signal, 'actor', 10, 'run-a');
    expect(current()).toBe(true);
    useWorkflowExecutionStore.setState({
      currentExecution: { id: 'run-b' } as AppExecution,
    });
    expect(current()).toBe(false);
    useWorkflowExecutionStore.setState({
      currentExecution: { id: 'run-a' } as AppExecution,
    });
    useChatInputStore.setState({ actorEpoch: 11 });
    expect(current()).toBe(false);
    useChatInputStore.setState({ actorEpoch: 10 });
    controller.abort();
    expect(current()).toBe(false);
  } finally {
    useChatInputStore.setState(originalActor);
    useWorkflowExecutionStore.setState(originalWorkflow);
  }
});
