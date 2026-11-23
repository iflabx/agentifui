import { useAgentInputCapabilities } from '@lib/hooks/use-agent-input-capabilities';
import {
  chatInputScope,
  useChatInputStore,
} from '@lib/stores/chat-input-store';
import { useChatStore } from '@lib/stores/chat-store';
import { act, fireEvent, render, screen } from '@testing-library/react';

import type { ComponentProps } from 'react';

import type { AgentInputCapabilities } from '../../packages/shared/src/agent-input';
import { ChatflowInputArea } from './chatflow-input-area';

let mockDescription: string | null;

jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => ({
    session: { user: { id: 'actor' } },
    loading: false,
  }),
}));
jest.mock('@lib/hooks/use-chat-input-route-sync', () => ({
  useChatInputRouteSync: () => ({ ready: true }),
  registerChatInputSubmission: () => () => undefined,
}));
jest.mock('@lib/hooks/use-chat-input-app', () => ({
  useChatInputApp: () => ({
    instance: {
      id: 'service',
      display_name: 'Example agent',
      description: mockDescription,
    },
    failed: false,
    retry: jest.fn(),
  }),
}));
jest.mock('@lib/hooks/use-agent-input-capabilities', () => ({
  useAgentInputCapabilities: jest.fn(),
  useRetainedInputCapabilities: (value: unknown) => value,
}));
jest.mock('@components/chat-input/edit-resend', () => ({
  useRegisterDifyEdit: jest.fn(),
}));
jest.mock('@lib/hooks/use-welcome-layout', () => ({
  useWelcomeLayout: () => ({ input: {} }),
}));
jest.mock('@lib/hooks/use-chat-width', () => ({
  useChatWidth: () => ({ widthClass: 'max-w-3xl' }),
}));
jest.mock('./chatflow-attachments', () => ({
  useChatflowAttachments: () => ({
    blocked: false,
    inputs: {},
    files: [],
    errors: [],
    consume: jest.fn(),
    action: null,
    preview: null,
  }),
}));
jest.mock('@components/chat-input/view', () => ({
  ChatInputView: ({
    beforeInput,
    value,
    onValueChange,
    onSubmit,
    canSubmit,
  }: ComponentProps<
    typeof import('@components/chat-input/view').ChatInputView
  >) => (
    <div>
      <div data-testid="before-input">{beforeInput}</div>
      <textarea
        aria-label="Message"
        value={value}
        onChange={event => onValueChange(event.target.value)}
      />
      <button
        type="button"
        disabled={!canSubmit}
        onClick={() => void onSubmit()}
      >
        Send
      </button>
    </div>
  ),
}));

let capabilities: AgentInputCapabilities;
const retry = jest.fn();
const props = { instanceId: 'app', onSubmit: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  mockDescription = 'Example initialization guidance';
  useChatInputStore.getState().setActor('actor');
  useChatInputStore.getState().clearAllMessages();
  useChatInputStore
    .getState()
    .setCurrentRoute(chatInputScope(0, 'actor', 'app', 'draft:new'));
  useChatStore.getState().clearMessages();
  capabilities = {
    version: 1,
    status: 'ready',
    mode: 'conversation',
    text: { enabled: true, required: true, target: 'query' },
    fields: [
      {
        key: 'topic',
        label: 'Topic',
        type: 'text-input',
        required: false,
        default: 'General',
      },
    ],
    attachmentSlots: [],
  };
  jest.mocked(useAgentInputCapabilities).mockImplementation(() => ({
    capabilities,
    isLoading: false,
    error: null,
    retry,
  }));
});

it('shows the admin description above the composer using assistant text styles and muted settings', () => {
  const { container } = render(<ChatflowInputArea {...props} />);
  const beforeInput = screen.getByTestId('before-input');
  expect(beforeInput).toHaveTextContent('Example initialization guidance');
  expect(screen.getAllByText('Example initialization guidance')).toHaveLength(
    1
  );
  expect(screen.queryByText('Example agent')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Topic')).toBeVisible();
  expect(screen.getByLabelText('Topic')).toHaveValue('General');
  expect(container.querySelector('details, summary')).toBeNull();
  expect(beforeInput.firstElementChild).toHaveClass(
    'text-xs',
    'text-stone-500'
  );
  const description = container.querySelector('[data-chatflow-description]');
  expect(description).toHaveTextContent('Example initialization guidance');
  expect(description).toHaveClass(
    'markdown-body',
    'assistant-message-content',
    'text-base',
    'text-stone-800',
    'dark:text-stone-200'
  );
  expect(description?.closest('header')).not.toHaveClass('text-center');
  expect(useChatStore.getState().messages).toEqual([]);
});

it.each([null, '', '   '])(
  'omits an empty app description (%s) without adding a fake message',
  description => {
    mockDescription = description;
    const { container } = render(<ChatflowInputArea {...props} />);
    expect(container.querySelector('[data-chatflow-description]')).toBeNull();
    expect(container.querySelector('header')).toBeNull();
    expect(screen.queryByText('Example agent')).not.toBeInTheDocument();
    expect(useChatStore.getState().messages).toEqual([]);
  }
);

it('preserves description line breaks and treats admin content as text, not HTML', () => {
  mockDescription = 'First line\nSecond line\n<script>alert("test")</script>';
  const { container } = render(<ChatflowInputArea {...props} />);
  const description = container.querySelector('[data-chatflow-description]');
  expect(description?.textContent).toBe(mockDescription);
  expect(description?.querySelector('p')).toHaveClass('whitespace-pre-wrap');
  expect(description?.querySelector('script')).toBeNull();
});
it('keeps required fields editable and validates them before submission', async () => {
  capabilities.fields[0].required = true;
  capabilities.fields[0].default = '';
  render(<ChatflowInputArea {...props} />);
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: 'Analyze this' },
  });
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText(/^Topic/), {
    target: { value: 'Research' },
  });
  expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  );
  expect(props.onSubmit).toHaveBeenCalledWith(
    'Analyze this',
    { topic: 'Research' },
    [],
    undefined,
    expect.any(Function)
  );
});

it('removes initialization entirely once a conversation starts and restores it for a new chat', () => {
  const { rerender } = render(<ChatflowInputArea {...props} />);
  act(() => {
    useChatStore.setState({
      messages: [{ id: 'message', isUser: true }] as never,
    });
  });
  rerender(
    <ChatflowInputArea {...props} isWelcomeScreen={false} isProcessing />
  );
  expect(screen.getByTestId('before-input')).toBeEmptyDOMElement();
  expect(screen.queryByLabelText('Topic')).not.toBeInTheDocument();
  expect(
    screen.queryByText('Example initialization guidance')
  ).not.toBeInTheDocument();
  act(() => useChatStore.getState().clearMessages());
  rerender(<ChatflowInputArea {...props} />);
  expect(screen.getByLabelText('Topic')).toBeVisible();
});

it('does not show initialization when reopening a saved conversation without loaded messages', () => {
  useChatInputStore
    .getState()
    .setCurrentRoute(chatInputScope(0, 'actor', 'app', 'conversation:saved'));
  render(<ChatflowInputArea {...props} isWelcomeScreen={false} />);
  expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Topic')).not.toBeInTheDocument();
  expect(
    screen.queryByText('Example initialization guidance')
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole('link', { name: 'pages.chatflow.composer.newTask' })
  ).toHaveAttribute('href', '/apps/chatflow/app');
});

it('retains fields and draft when a request is rejected before acceptance', async () => {
  props.onSubmit.mockResolvedValueOnce({
    ok: false,
    errorCode: 'REQUEST_FAILED',
  });
  render(<ChatflowInputArea {...props} />);
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: 'Retry this' },
  });
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  );
  expect(screen.getByLabelText('Topic')).toHaveValue('General');
  expect(screen.getByLabelText('Message')).toHaveValue('Retry this');
});

it('still exposes capability errors and retry after the initialization guidance disappears', () => {
  capabilities.status = 'unavailable';
  useChatInputStore
    .getState()
    .setCurrentRoute(chatInputScope(0, 'actor', 'app', 'conversation:saved'));
  render(<ChatflowInputArea {...props} isWelcomeScreen={false} />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'input.capabilitiesUnavailable'
  );
  expect(screen.queryByLabelText('Topic')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'common.ui.retry' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

it('blocks follow-up submission while executing and removes the composer afterwards', async () => {
  useChatInputStore
    .getState()
    .setCurrentRoute(chatInputScope(0, 'actor', 'app', 'conversation:saved'));
  const { rerender } = render(
    <ChatflowInputArea {...props} isWelcomeScreen={false} isProcessing />
  );
  fireEvent.change(screen.getByLabelText('Message'), {
    target: { value: 'Another turn' },
  });
  expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  await act(async () =>
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
  );
  expect(props.onSubmit).not.toHaveBeenCalled();
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
  rerender(<ChatflowInputArea {...props} isWelcomeScreen={false} />);
  expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('composer.singleTurn');
});
