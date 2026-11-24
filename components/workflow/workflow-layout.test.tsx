import { useMobile } from '@lib/hooks/use-mobile';
import { getExecutionById } from '@lib/services/client/app-executions-api';
import { useAppListStore } from '@lib/stores/app-list-store';
import { useWorkflowExecutionStore } from '@lib/stores/workflow-execution-store';
import { useWorkflowHistoryStore } from '@lib/stores/workflow-history-store';
import type { AppExecution } from '@lib/types/database';
import { fireEvent, render, screen } from '@testing-library/react';

import type { ReactNode } from 'react';

import { useSearchParams } from 'next/navigation';

import { WorkflowLayout } from './workflow-layout';

const openProcess = () =>
  fireEvent.click(
    screen.getByRole('button', { name: 'executionProcess.view' })
  );

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: jest.fn() }),
  usePathname: () => '/apps/workflow/app-one',
  useSearchParams: jest.fn(),
}));

const mockSavedExecution: AppExecution = {
  id: 'saved-task',
  user_id: 'user',
  service_instance_id: 'internal-app',
  external_execution_id: null,
  task_id: null,
  title: 'Saved task',
  inputs: {},
  error_message: null,
  total_steps: 1,
  total_tokens: 0,
  elapsed_time: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:01Z',
  completed_at: '2026-01-01T00:00:01Z',
  execution_type: 'workflow',
  status: 'completed',
  outputs: { value: 'Saved output' },
  metadata: {
    node_executions: [
      { node_id: 'saved-step', title: 'Saved step B', status: 'succeeded' },
    ],
  },
};
let mockActorId = 'user';
let mockLiveError: string | null = null;
const mockRetryExecution = jest.fn();
const mockClearExecutionState = jest.fn();

jest.mock('@components/file-preview/file-preview-canvas', () => ({
  FilePreviewCanvas: () => <div data-testid="workflow-file-preview" />,
}));
jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => ({ session: { user: { id: mockActorId } } }),
}));
jest.mock('@lib/hooks/use-mobile', () => ({ useMobile: jest.fn() }));
jest.mock('@lib/services/client/app-executions-api', () => ({
  getExecutionById: jest.fn(),
}));
jest.mock('@lib/hooks/use-workflow-execution', () => ({
  useWorkflowExecution: () => ({
    isExecuting: !mockLiveError,
    error: mockLiveError,
    canRetry: true,
    currentExecution: { id: 'live-task', status: 'running', metadata: {} },
    executeWorkflow: jest.fn(),
    stopWorkflowExecution: jest.fn(),
    canStop: true,
    retryExecution: mockRetryExecution,
    resetExecution: jest.fn(),
    clearExecutionState: mockClearExecutionState,
  }),
}));
jest.mock('@components/ui/resizable-split-pane', () => ({
  ResizableSplitPane: ({
    left,
    right,
  }: {
    left: ReactNode;
    right: ReactNode;
  }) => (
    <div>
      {left}
      {right}
    </div>
  ),
}));
jest.mock('@components/workflow/mobile-tab-switcher', () => ({
  MobileTabSwitcher: ({
    onTabChange,
  }: {
    onTabChange: (tab: string) => void;
  }) => <button onClick={() => onTabChange('history')}>Open history</button>,
}));
jest.mock('./workflow-input-form', () => ({ WorkflowInputForm: () => null }));
jest.mock('./execution-history', () => ({
  ExecutionHistory: ({
    onViewResult,
  }: {
    onViewResult: (
      result: Record<string, unknown>,
      execution: AppExecution
    ) => void;
  }) => (
    <button
      onClick={() =>
        onViewResult(mockSavedExecution.outputs!, mockSavedExecution)
      }
    >
      Select saved task
    </button>
  ),
}));
jest.mock('./workflow-tracker/result-viewer', () => ({
  ResultViewer: ({ onClose }: { onClose: () => void }) => (
    <button onClick={onClose}>Close result</button>
  ),
}));

describe('Workflow historical selection boundary', () => {
  it('mounts the shared attachment preview panel', () => {
    render(<WorkflowLayout instanceId="app-one" />);
    expect(screen.getByTestId('workflow-file-preview')).toBeInTheDocument();
  });

  beforeEach(() => {
    mockActorId = 'user';
    mockLiveError = null;
    mockRetryExecution.mockClear();
    mockClearExecutionState.mockClear();
    jest.mocked(useMobile).mockReturnValue(false);
    jest
      .mocked(useSearchParams)
      .mockReturnValue(
        new URLSearchParams() as ReturnType<typeof useSearchParams>
      );
    useWorkflowHistoryStore.setState({ showHistory: true });
    useWorkflowExecutionStore.getState().reset();
    useWorkflowExecutionStore.setState({
      nodes: [
        {
          id: 'live-step',
          title: 'Live step A',
          status: 'running',
          visible: true,
          description: '',
        },
      ],
    });
  });

  it.each([false, true])(
    'hides live error actions while viewing history and restores them on exit (mobile=%s)',
    mobile => {
      mockLiveError = 'Live task A failed';
      jest.mocked(useMobile).mockReturnValue(mobile);
      render(<WorkflowLayout instanceId="app-one" />);
      expect(screen.getByText(mockLiveError)).toBeInTheDocument();
      expect(
        screen.getByTitle('pages.workflow.buttons.retry')
      ).toBeInTheDocument();
      if (mobile)
        fireEvent.click(screen.getByRole('button', { name: 'Open history' }));
      fireEvent.click(
        screen.getByRole('button', { name: 'Select saved task' })
      );
      fireEvent.click(screen.getByRole('button', { name: 'Close result' }));
      openProcess();
      expect(screen.getByText('Saved step B')).toBeInTheDocument();
      expect(screen.queryByText(mockLiveError)).not.toBeInTheDocument();
      expect(
        screen.queryByTitle('pages.workflow.buttons.retry')
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTitle('pages.workflow.buttons.close')
      ).not.toBeInTheDocument();
      expect(mockRetryExecution).not.toHaveBeenCalled();
      expect(mockClearExecutionState).not.toHaveBeenCalled();
      fireEvent.click(
        screen.getByRole('button', { name: 'executionProcess.close' })
      );
      expect(screen.queryByText('Saved step B')).not.toBeInTheDocument();
      expect(screen.queryByText(mockLiveError)).not.toBeInTheDocument();
      fireEvent.click(
        screen.getByRole('button', { name: 'pages.workflow.buttons.reset' })
      );
      expect(screen.getByText(mockLiveError)).toBeInTheDocument();
      fireEvent.click(screen.getByTitle('pages.workflow.buttons.retry'));
      expect(mockRetryExecution).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByTitle('pages.workflow.buttons.close'));
      expect(mockClearExecutionState).toHaveBeenCalledTimes(1);
    }
  );

  it.each([false, true])(
    'shows the selected history immediately while another execution runs (mobile=%s)',
    mobile => {
      jest.mocked(useMobile).mockReturnValue(mobile);
      const { rerender } = render(<WorkflowLayout instanceId="app-one" />);
      if (mobile)
        fireEvent.click(screen.getByRole('button', { name: 'Open history' }));
      fireEvent.click(
        screen.getByRole('button', { name: 'Select saved task' })
      );
      openProcess();
      expect(screen.getByText('Saved step B')).toBeInTheDocument();
      expect(screen.queryByText('Live step A')).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'pages.workflow.buttons.stop' })
      ).not.toBeInTheDocument();
      expect(useWorkflowExecutionStore.getState().nodes[0].title).toBe(
        'Live step A'
      );
      rerender(<WorkflowLayout instanceId="app-two" />);
      expect(screen.queryByText('Saved step B')).not.toBeInTheDocument();
    }
  );

  it('uses the same historical branch for URL restoration and clears local history across accounts', async () => {
    jest
      .mocked(useSearchParams)
      .mockReturnValue(
        new URLSearchParams('executionId=saved-task') as ReturnType<
          typeof useSearchParams
        >
      );
    useAppListStore.setState({
      apps: [{ instance_id: 'app-one', id: 'internal-app' }] as ReturnType<
        typeof useAppListStore.getState
      >['apps'],
    });
    jest
      .mocked(getExecutionById)
      .mockResolvedValue({ success: true, data: mockSavedExecution });
    const { rerender } = render(<WorkflowLayout instanceId="app-one" />);
    await screen.findByRole('button', { name: 'Close result' });
    fireEvent.click(screen.getByRole('button', { name: 'Close result' }));
    expect(screen.queryByText('Saved step B')).not.toBeInTheDocument();
    openProcess();
    const panel = screen.getByRole('region', {
      name: 'executionProcess.title',
    });
    expect(panel.closest('[data-execution-process-panel]')).toHaveClass(
      'fixed',
      'md:right-4'
    );
    expect(panel).toContainElement(screen.getByText('Saved step B'));
    expect(screen.queryByText('Live step A')).not.toBeInTheDocument();
    jest
      .mocked(useSearchParams)
      .mockReturnValue(
        new URLSearchParams() as ReturnType<typeof useSearchParams>
      );
    mockActorId = 'other-user';
    rerender(<WorkflowLayout instanceId="app-one" />);
    expect(screen.queryByText('Saved step B')).not.toBeInTheDocument();
  });
});
