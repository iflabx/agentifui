import {
  getConversationExecutions,
  reserveTaskExecution,
  updateExecutionStatus,
} from '@lib/services/client/app-executions-api';
import type { AppExecution } from '@lib/types/database';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { useEffect } from 'react';

import { TaskChat } from './task-chat';

const mockExecute = jest.fn();
const mockFetch = jest.fn();
const mockMounts = jest.fn();
const mockRestore = jest.fn();
const mockAuth: {
  session: { user: { id: string } } | null;
  loading: boolean;
} = { session: { user: { id: 'actor' } }, loading: false };
const mockApps = [
  {
    id: 'app-uuid',
    instance_id: 'task-app',
    config: { app_metadata: { dify_apptype: 'workflow' } },
  },
];
jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => mockAuth,
}));
jest.mock('@lib/stores/app-list-store', () => ({
  useAppListStore: (selector: (state: unknown) => unknown) =>
    selector({ apps: mockApps, fetchApps: mockFetch }),
}));
jest.mock('@lib/stores/workflow-execution-store', () => ({
  useWorkflowExecutionStore: (selector: (state: unknown) => unknown) =>
    selector({ nodes: [] }),
}));
jest.mock('@lib/hooks/use-workflow-execution', () => ({
  useWorkflowExecution: () => {
    useEffect(() => {
      mockMounts();
    }, []);
    return {
      isExecuting: false,
      currentExecution: null,
      error: null,
      executeWorkflow: mockExecute,
    };
  },
}));
jest.mock('@lib/hooks/use-text-generation-execution', () => ({
  useTextGenerationExecution: () => ({
    isExecuting: false,
    currentExecution: null,
    error: null,
    executeTextGeneration: mockExecute,
  }),
}));
jest.mock('@lib/hooks/use-chat-width', () => ({
  useChatWidth: () => ({ widthClass: '', paddingClass: '' }),
}));
jest.mock('@lib/hooks/use-mobile', () => ({ useMobile: () => false }));
jest.mock('@lib/hooks/use-combined-conversations', () => ({
  conversationEvents: { emit: jest.fn() },
}));
jest.mock('@lib/services/client/app-executions-api', () => ({
  reserveTaskExecution: jest.fn(),
  getConversationExecutions: jest.fn(),
  updateExecutionStatus: jest.fn(),
}));
jest.mock('@components/workflow/workflow-input-form', () => {
  const React = jest.requireActual('react');
  return {
    WorkflowInputForm: React.forwardRef(function MockWorkflowInputForm(
      {
        onExecute,
        isExecuting,
      }: {
        onExecute: (input: unknown) => void;
        isExecuting: boolean;
      },
      ref: React.Ref<unknown>
    ) {
      React.useImperativeHandle(ref, () => ({ restoreInputs: mockRestore }));
      return (
        <>
          <input type="file" aria-label="Task attachment" />
          <button
            disabled={isExecuting}
            onClick={() => onExecute({ topic: 'test' })}
          >
            submit task
          </button>
        </>
      );
    }),
  };
});
jest.mock('@components/chat/messages/user-message/user-message', () => ({
  UserMessage: ({ content }: { content: string }) => <p>{content}</p>,
}));
jest.mock(
  '@components/chat/messages/assistant-message/assistant-message',
  () => ({
    AssistantMessage: ({ content }: { content: string }) => <p>{content}</p>,
  })
);
jest.mock('@components/execution-process/disclosure', () => ({
  ExecutionProcessDisclosure: () => null,
}));
jest.mock('@components/file-preview/file-preview-canvas', () => ({
  FilePreviewCanvas: () => null,
}));
jest.mock('@components/workflow/workflow-tracker/result-viewer', () => ({
  ResultViewer: ({ result }: { result: unknown }) => (
    <pre>{JSON.stringify(result)}</pre>
  ),
}));

function execution(id: string): AppExecution {
  return {
    id,
    inputs: { topic: id },
    outputs: { result: `answer-${id}` },
    status: 'completed',
    metadata: {},
    created_at: `2026-01-01 00:00:${id.padStart(2, '0')}+00`,
    service_instance_id: 'app-uuid',
    user_id: 'actor',
    conversation_id: 'conversation',
    execution_type: 'workflow',
    external_execution_id: null,
    task_id: null,
    title: `Task ${id}`,
    error_message: null,
    total_steps: 0,
    total_tokens: 0,
    elapsed_time: null,
    updated_at: '2026-01-01 00:00:00+00',
    completed_at: '2026-01-01 00:00:00+00',
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.session = { user: { id: 'actor' } };
  mockAuth.loading = false;
  mockApps[0].config.app_metadata.dify_apptype = 'workflow';
  mockExecute.mockResolvedValue(true);
  jest
    .mocked(updateExecutionStatus)
    .mockResolvedValue({ success: true, data: true });
  jest.mocked(getConversationExecutions).mockResolvedValue({
    success: true,
    data: { executions: [], hasMore: false, nextCursor: null },
  });
  jest.mocked(reserveTaskExecution).mockResolvedValue({
    success: true,
    data: {
      conversationId: 'conversation',
      execution: execution('1'),
      replayed: false,
    },
  });
  window.history.replaceState({}, '', '/apps/workflow/task-app');
});

it.each(['workflow', 'text-generation'] as const)(
  'keeps the %s file input mounted during same-user session refresh',
  async taskType => {
    mockApps[0].config.app_metadata.dify_apptype = taskType;
    const props = { instanceId: 'task-app', taskType };
    const view = render(<TaskChat {...props} />);
    const input = screen.getByLabelText('Task attachment');
    mockAuth.loading = true;
    view.rerender(<TaskChat {...props} />);
    expect(input.isConnected).toBe(true);
    expect(screen.getByLabelText('Task attachment')).toBe(input);
    mockAuth.loading = false;
    view.rerender(<TaskChat {...props} />);
    expect(screen.getByLabelText('Task attachment')).toBe(input);
  }
);

it.each(['logout', 'different-user'])(
  'discards the previous file input after %s',
  change => {
    const props = { instanceId: 'task-app', taskType: 'workflow' as const };
    const view = render(<TaskChat {...props} />);
    const input = screen.getByLabelText('Task attachment');
    mockAuth.session = change === 'logout' ? null : { user: { id: 'other' } };
    view.rerender(<TaskChat {...props} />);
    expect(input.isConnected).toBe(false);
    if (change === 'logout')
      expect(
        screen.queryByLabelText('Task attachment')
      ).not.toBeInTheDocument();
    else expect(screen.getByLabelText('Task attachment')).not.toBe(input);
  }
);

it('adopts a reserved URL without unmounting the active runner', async () => {
  let finish!: (accepted: boolean) => void;
  mockExecute.mockImplementationOnce(
    () =>
      new Promise<boolean>(resolve => {
        finish = resolve;
      })
  );
  const view = render(<TaskChat instanceId="task-app" taskType="workflow" />);
  fireEvent.click(screen.getByRole('button', { name: 'submit task' }));
  await waitFor(() => expect(mockExecute).toHaveBeenCalledTimes(1));
  expect(window.location.search).toContain('conversationId=conversation');
  view.rerender(
    <TaskChat
      instanceId="task-app"
      conversationId="conversation"
      taskType="workflow"
    />
  );
  expect(mockMounts).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish(true);
  });
  expect(
    screen.getByRole('button', { name: 'submit task' })
  ).not.toBeDisabled();
  await act(async () => {
    view.rerender(
      <TaskChat
        instanceId="task-app"
        conversationId="other"
        taskType="workflow"
      />
    );
  });
  expect(mockMounts).toHaveBeenCalledTimes(2);
});

it('keeps saved history readable but disables sending when the app task mode changed', async () => {
  mockApps[0].config.app_metadata.dify_apptype = 'chatflow';
  jest.mocked(getConversationExecutions).mockResolvedValue({
    success: true,
    data: { executions: [execution('1')], hasMore: false, nextCursor: null },
  });
  render(
    <TaskChat
      instanceId="task-app"
      conversationId="conversation"
      taskType="workflow"
    />
  );
  await screen.findByText('topic: 1');
  expect(screen.getByRole('button', { name: 'submit task' })).toBeDisabled();
  expect(reserveTaskExecution).not.toHaveBeenCalled();
});

it('starts a fresh task conversation when the user revisits the same app without a conversation ID', async () => {
  const view = render(<TaskChat instanceId="task-app" taskType="workflow" />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'submit task' }));
  });
  view.rerender(
    <TaskChat
      instanceId="task-app"
      conversationId="conversation"
      taskType="workflow"
    />
  );
  expect(mockMounts).toHaveBeenCalledTimes(1);
  window.history.replaceState({}, '', '/apps/workflow/task-app');
  view.rerender(<TaskChat instanceId="task-app" taskType="workflow" />);
  expect(mockMounts).toHaveBeenCalledTimes(2);
  expect(screen.queryByText('topic: 1')).not.toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'submit task' }));
  });
  expect(jest.mocked(reserveTaskExecution).mock.calls[1][0]).not.toHaveProperty(
    'conversationId'
  );
});

it('reserves once and executes that same row with the same submission ID', async () => {
  render(<TaskChat instanceId="task-app" taskType="workflow" />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'submit task' }));
  });
  expect(reserveTaskExecution).toHaveBeenCalledTimes(1);
  const request = jest.mocked(reserveTaskExecution).mock.calls[0][0];
  expect(mockExecute).toHaveBeenCalledWith(
    { topic: 'test' },
    { execution: execution('1'), submissionId: request.submissionId }
  );
  expect(screen.getAllByText('topic: 1')).toHaveLength(1);
  expect(window.location.search).toContain('conversationId=conversation');
});

it('does not reexecute an already reserved submission or pretend it completed', async () => {
  jest.mocked(reserveTaskExecution).mockResolvedValue({
    success: true,
    data: {
      conversationId: 'conversation',
      execution: { ...execution('1'), status: 'running' },
      replayed: true,
    },
  });
  render(<TaskChat instanceId="task-app" taskType="workflow" />);
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'submit task' }));
  });
  expect(mockExecute).not.toHaveBeenCalled();
  expect(screen.getByText('replayed')).toBeInTheDocument();
  expect(screen.getByText('unknown')).toBeInTheDocument();
});

it('loads a conversation page then older records by its returned cursor without duplicates', async () => {
  jest
    .mocked(getConversationExecutions)
    .mockResolvedValueOnce({
      success: true,
      data: {
        executions: [execution('2'), execution('3')],
        hasMore: true,
        nextCursor: '2',
      },
    })
    .mockResolvedValueOnce({
      success: true,
      data: {
        executions: [execution('1'), execution('2')],
        hasMore: false,
        nextCursor: null,
      },
    });
  render(
    <TaskChat
      appId="app-uuid"
      conversationId="conversation"
      taskType="text-generation"
    />
  );
  await waitFor(() => expect(screen.getByText('topic: 2')).toBeInTheDocument());
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'loadOlder' }));
  });
  expect(getConversationExecutions).toHaveBeenLastCalledWith(
    'conversation',
    '2'
  );
  expect(screen.getAllByText('topic: 2')).toHaveLength(1);
  expect(screen.getByText('topic: 1')).toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'loadOlder' })
  ).not.toBeInTheDocument();
});

it('blocks new executions when saved conversation access is rejected', async () => {
  jest
    .mocked(getConversationExecutions)
    .mockResolvedValue({ success: false, error: new Error('forbidden') });
  render(
    <TaskChat
      appId="app-uuid"
      conversationId="conversation"
      taskType="workflow"
    />
  );
  await waitFor(() =>
    expect(screen.getByText(/historyFailed/)).toBeInTheDocument()
  );
  expect(screen.getByRole('button', { name: 'submit task' })).toBeDisabled();
  expect(mockExecute).not.toHaveBeenCalled();
});

it('moves input reuse into more options without automatically executing', async () => {
  jest.mocked(getConversationExecutions).mockResolvedValue({
    success: true,
    data: { executions: [execution('1')], hasMore: false, nextCursor: null },
  });
  render(
    <TaskChat
      instanceId="task-app"
      conversationId="conversation"
      taskType="workflow"
    />
  );
  await screen.findByText('topic: 1');
  expect(
    screen.queryByRole('button', { name: 'runAgain' })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole('button', { name: 'viewResult' })
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'ariaLabel' }));
  fireEvent.click(await screen.findByRole('button', { name: 'runAgain' }));
  await waitFor(() => expect(mockRestore).toHaveBeenCalledWith({ topic: '1' }));
  expect(mockExecute).not.toHaveBeenCalled();
  expect(reserveTaskExecution).not.toHaveBeenCalled();
});

it('retains explicit interrupted task recovery and restores inputs only after the status update succeeds', async () => {
  jest.mocked(getConversationExecutions).mockResolvedValue({
    success: true,
    data: {
      executions: [{ ...execution('1'), status: 'running' }],
      hasMore: false,
      nextCursor: null,
    },
  });
  render(
    <TaskChat
      instanceId="task-app"
      conversationId="conversation"
      taskType="workflow"
    />
  );
  await screen.findByText('topic: 1');
  expect(screen.getByRole('button', { name: 'submit task' })).toBeDisabled();
  jest
    .mocked(updateExecutionStatus)
    .mockResolvedValueOnce({ success: false, error: new Error('denied') });
  fireEvent.click(screen.getByRole('button', { name: 'recoverTask' }));
  await screen.findByText(/historyFailed/);
  expect(mockRestore).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'recoverTask' }));
  await waitFor(() => expect(mockRestore).toHaveBeenCalledWith({ topic: '1' }));
  expect(
    screen.getByRole('button', { name: 'submit task' })
  ).not.toBeDisabled();
  expect(mockExecute).not.toHaveBeenCalled();
});

it('keeps the result viewer available for every field of a complex result', async () => {
  const outputs = {
    result1: 'first answer',
    result2: 'second answer',
    files: [{ url: '/file' }],
  };
  jest.mocked(getConversationExecutions).mockResolvedValue({
    success: true,
    data: {
      executions: [{ ...execution('1'), outputs }],
      hasMore: false,
      nextCursor: null,
    },
  });
  render(
    <TaskChat
      instanceId="task-app"
      conversationId="conversation"
      taskType="workflow"
    />
  );
  await screen.findByText('topic: 1');
  fireEvent.click(screen.getByRole('button', { name: 'viewResult' }));
  expect(screen.getByText(JSON.stringify({ outputs }))).toBeInTheDocument();
});
