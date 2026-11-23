import { AppRequestError } from '@lib/errors/app-error';
import { getConversationByExternalId } from '@lib/services/client/conversations-api';
import { uploadDifyFile } from '@lib/services/dify/file-service';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { useChatStore } from '@lib/stores/chat-store';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { ChatflowInputArea } from './chatflow-input-area';

const showNotification = jest.fn();
let mockPathname = '/apps/chatflow/app-1';
let mockAuthLoading = false;
jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}));
jest.mock('@lib/services/client/conversations-api', () => ({
  getConversationByExternalId: jest.fn(),
}));
const ready = {
  version: 1,
  status: 'ready',
  mode: 'conversation',
  text: { enabled: true, required: true, target: 'query' },
  fields: [],
  attachmentSlots: [],
};
jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => ({
    session: { user: { id: 'actor' } },
    loading: mockAuthLoading,
  }),
}));
jest.mock('@lib/services/dify/file-service', () => ({
  uploadDifyFile: jest.fn(),
}));

jest.mock('next-intl', () => ({
  useTranslations: (namespace?: string) => {
    if (namespace === 'errors.system.moderation') {
      return (
        key: string,
        values?: {
          categories?: string;
        }
      ) => {
        switch (key) {
          case 'blocked':
            return 'Your message did not pass the safety guard model review. Please revise it and try again.';
          case 'blockedWithCategories':
            return `Your message did not pass the safety guard model review. Unsafe category: ${values?.categories}. Please revise it and try again.`;
          case 'unavailable':
            return 'The safety guard model review service is temporarily unavailable. Please try again later.';
          default:
            return key;
        }
      };
    }

    return (key: string) => key;
  },
}));

jest.mock('@lib/hooks/use-chat-width', () => ({
  useChatWidth: () => ({
    widthClass: 'max-w-3xl',
    paddingClass: 'px-4',
  }),
}));

jest.mock('@lib/hooks/use-current-app', () => ({
  useCurrentApp: () => ({
    currentAppInstance: {
      instance_id: 'app-1',
    },
  }),
}));

jest.mock('@lib/stores/ui/notification-store', () => ({
  useNotificationStore: {
    getState: () => ({
      showNotification,
    }),
  },
}));

describe('Chatflow standard composer', () => {
  const originalFetch = global.fetch;
  const mockedFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname = '/apps/chatflow/app-1';
    mockAuthLoading = false;
    jest.mocked(getConversationByExternalId).mockResolvedValue({
      success: true,
      data: { id: 'saved-1', app_id: 'app-1', user_id: 'actor' },
    } as never);
    useChatInputStore.getState().setActor(null);
    useChatInputStore.getState().setActor('actor');
    useAttachmentStore.getState().resetAll();
    useChatStore.setState({ messages: [] });
    global.fetch = mockedFetch;
    mockedFetch.mockImplementation(async url =>
      String(url).includes('input-capabilities')
        ? ({
            ok: true,
            json: async () => ready,
          } as Response)
        : ({
            ok: true,
            json: async () => ({
              success: true,
              app: {
                id: 'uuid-1',
                instance_id: 'app-1',
                config: {
                  dify_parameters: {
                    user_input_form: [],
                  },
                },
              },
            }),
          } as Response)
    );
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('keeps the open picker and selected file through same-user focus revalidation, then uploads once', async () => {
    mockedFetch.mockImplementation(
      async url =>
        ({
          ok: true,
          json: async () =>
            String(url).includes('input-capabilities')
              ? {
                  ...ready,
                  attachmentSlots: [
                    {
                      key: 'file',
                      label: 'Source',
                      target: 'inputs',
                      minCount: 1,
                      maxCount: 1,
                      multiple: false,
                      methods: ['local_file'],
                      allowedTypes: ['document'],
                      extensions: ['txt'],
                      maxBytesByType: { document: 1024 },
                    },
                  ],
                }
              : { success: true, app: { id: 'uuid-1', instance_id: 'app-1' } },
        }) as Response
    );
    jest
      .mocked(uploadDifyFile)
      .mockResolvedValue({ id: 'selected-file' } as never);
    const onSubmit = jest.fn().mockResolvedValue({ ok: true });
    const view = render(
      <ChatflowInputArea instanceId="app-1" onSubmit={onSubmit} />
    );
    const picker = await screen.findByLabelText('Source', {
      selector: 'input',
    });
    const input = screen.getByPlaceholderText('form.question.placeholder');
    fireEvent.change(input, { target: { value: 'summarize' } });
    mockAuthLoading = true;
    view.rerender(<ChatflowInputArea instanceId="app-1" onSubmit={onSubmit} />);
    expect(screen.getByLabelText('Source', { selector: 'input' })).toBe(picker);
    expect(picker.isConnected).toBe(true);
    fireEvent.change(picker, {
      target: {
        files: [new File(['synthetic'], 'focus.txt', { type: 'text/plain' })],
      },
    });
    expect(await screen.findByText('focus.txt')).toBeInTheDocument();
    expect(uploadDifyFile).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: 'input.sendMessage' })
    ).toBeDisabled();
    mockAuthLoading = false;
    view.rerender(<ChatflowInputArea instanceId="app-1" onSubmit={onSubmit} />);
    await waitFor(() => expect(uploadDifyFile).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'input.sendMessage' })
      ).not.toBeDisabled()
    );
    expect(input).toHaveValue('summarize');
    expect(screen.getByLabelText('Source', { selector: 'input' })).toBe(picker);
    fireEvent.click(screen.getByRole('button', { name: 'input.sendMessage' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        'summarize',
        { file: expect.objectContaining({ upload_file_id: 'selected-file' }) },
        [],
        undefined,
        expect.any(Function)
      )
    );
  });

  it('keeps the common composer without an attachment action for a text-only app', async () => {
    const view = render(
      <ChatflowInputArea instanceId="app-1" onSubmit={jest.fn()} />
    );
    const query = await screen.findByPlaceholderText(
      'form.question.placeholder'
    );
    fireEvent.change(query, { target: { value: 'hello' } });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'input.sendMessage' })
      ).not.toBeDisabled()
    );
    expect(
      view.container.querySelector('[data-chat-input-container] textarea')
    ).toBe(query);
    expect(view.container.querySelector('input[type="file"]')).toBeNull();
    expect(
      screen.queryByText('form.startConversation')
    ).not.toBeInTheDocument();
  });

  it('shows required settings directly, associates labels and sends only initialized fields', async () => {
    mockedFetch.mockImplementation(
      async url =>
        ({
          ok: true,
          json: async () =>
            String(url).includes('input-capabilities')
              ? {
                  ...ready,
                  fields: [
                    {
                      key: 'Exact_Topic',
                      label: 'Topic',
                      type: 'text-input',
                      required: true,
                    },
                  ],
                }
              : { success: true, app: { id: 'uuid-1', instance_id: 'app-1' } },
        }) as Response
    );
    const onSubmit = jest.fn().mockResolvedValue({ ok: true });
    const view = render(
      <ChatflowInputArea instanceId="app-1" onSubmit={onSubmit} />
    );
    const field = await screen.findByLabelText('Topic', { exact: false });
    expect(field).toBeVisible();
    expect(view.container.querySelector('details, summary')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText('form.question.placeholder'), {
      target: { value: 'question' },
    });
    expect(
      screen.getByRole('button', { name: 'input.sendMessage' })
    ).toBeDisabled();
    fireEvent.change(field, { target: { value: 'topic value' } });
    fireEvent.click(screen.getByRole('button', { name: 'input.sendMessage' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        'question',
        { Exact_Topic: 'topic value' },
        [],
        undefined,
        expect.any(Function)
      )
    );
  });

  it('keeps native history read-only without requiring initialization files again', async () => {
    mockPathname = '/chat/native-id';
    mockedFetch.mockImplementation(
      async url =>
        ({
          ok: true,
          json: async () =>
            String(url).includes('input-capabilities')
              ? {
                  ...ready,
                  fields: [
                    {
                      key: 'topic',
                      label: 'Topic',
                      type: 'text-input',
                      required: true,
                    },
                  ],
                  attachmentSlots: [
                    {
                      key: 'source',
                      label: 'Initial document',
                      target: 'inputs',
                      minCount: 1,
                      maxCount: 1,
                      methods: ['local_file'],
                      allowedTypes: ['document'],
                      extensions: ['txt'],
                      maxBytesByType: { document: 1024 },
                    },
                  ],
                }
              : { success: true, app: { id: 'uuid-1', instance_id: 'app-1' } },
        }) as Response
    );
    useChatStore.setState({
      messages: [
        {
          id: 'first',
          text: 'first question',
          isUser: true,
          metadata: { chatflow_initial_inputs: { topic: 'Saved topic' } },
        },
      ],
    });
    const onSubmit = jest.fn().mockResolvedValue({ ok: true });
    const view = render(
      <ChatflowInputArea
        instanceId="app-1"
        onSubmit={onSubmit}
        isWelcomeScreen={false}
      />
    );
    const newTask = await screen.findByRole('link', {
      name: 'composer.newTask',
    });
    expect(newTask).toHaveAttribute('href', '/apps/chatflow/app-1');
    expect(
      screen.queryByPlaceholderText('form.question.placeholder')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Saved topic')).not.toBeInTheDocument();
    expect(view.container.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByLabelText('Topic')).not.toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('clears an accepted snapshot immediately but never clears a newer draft on late completion', async () => {
    let finish!: (result: unknown) => void;
    let accept!: () => void;
    const onSubmit = jest.fn((_query, _inputs, _files, _edit, accepted) => {
      accept = accepted;
      return new Promise(resolve => {
        finish = resolve;
      });
    });
    render(<ChatflowInputArea instanceId="app-1" onSubmit={onSubmit} />);
    const query = await screen.findByPlaceholderText(
      'form.question.placeholder'
    );
    fireEvent.change(query, { target: { value: 'submitted' } });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'input.sendMessage' })
      ).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'input.sendMessage' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(query).toHaveValue('submitted');
    act(() => accept());
    expect(query).toHaveValue('');
    fireEvent.change(query, { target: { value: 'next draft' } });
    await act(async () => finish({ ok: true }));
    expect(query).toHaveValue('next draft');
  });

  it('preserves a definitely refused draft and shows the ordinary error', async () => {
    const onSubmit = jest.fn().mockResolvedValue({
      ok: false,
      errorCode: 'INPUT_FILES_REQUIRED',
      errorMessage: 'Requirements changed',
      surfaced: false,
    });
    render(<ChatflowInputArea instanceId="app-1" onSubmit={onSubmit} />);
    const query = await screen.findByPlaceholderText(
      'form.question.placeholder'
    );
    fireEvent.change(query, { target: { value: 'keep this draft' } });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'input.sendMessage' })
      ).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'input.sendMessage' }));
    await waitFor(() =>
      expect(showNotification).toHaveBeenCalledWith(
        'Requirements changed',
        'error',
        5000
      )
    );
    expect(query).toHaveValue('keep this draft');
  });

  it('clears the query and shows a warning when submission is blocked by moderation', async () => {
    const onSubmit = jest.fn().mockResolvedValue({
      ok: false,
      surfaced: false,
      errorCode: 'CONTENT_MODERATION_BLOCKED',
      errorMessage: 'blocked by moderation',
    });

    render(<ChatflowInputArea instanceId="app-1" onSubmit={onSubmit} />);

    const textarea = await screen.findByPlaceholderText(
      'form.question.placeholder'
    );
    fireEvent.change(textarea, {
      target: {
        value: 'unsafe message',
      },
    });

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'input.sendMessage' })
      ).not.toBeDisabled()
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'input.sendMessage',
      })
    );

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        'unsafe message',
        {},
        [],
        undefined,
        expect.any(Function)
      );
    });

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalledWith(
        'Your message did not pass the safety guard model review. Please revise it and try again.',
        'warning',
        5000
      );
      expect(
        screen.getByPlaceholderText('form.question.placeholder')
      ).toHaveValue('');
    });
  });

  it('shows localized moderation categories when submission throws an app error', async () => {
    const onSubmit = jest.fn().mockRejectedValue(
      new AppRequestError('blocked', 400, {
        code: 'CONTENT_MODERATION_BLOCKED',
        source: 'dify-proxy',
        severity: 'error',
        retryable: false,
        userMessage: 'blocked by moderation',
        developerMessage:
          'Input moderation blocked the request. Categories: Violent',
        requestId: 'req-2',
        occurredAt: '2026-03-31T00:00:00.000Z',
        context: {
          moderation_categories: ['Violent'],
        },
      })
    );

    render(<ChatflowInputArea instanceId="app-1" onSubmit={onSubmit} />);

    const textarea = await screen.findByPlaceholderText(
      'form.question.placeholder'
    );
    fireEvent.change(textarea, {
      target: {
        value: 'unsafe message',
      },
    });

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'input.sendMessage' })
      ).not.toBeDisabled()
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'input.sendMessage',
      })
    );

    await waitFor(() => {
      expect(showNotification).toHaveBeenCalledWith(
        'Your message did not pass the safety guard model review. Unsafe category: Violent. Please revise it and try again.',
        'warning',
        5000
      );
      expect(
        screen.getByPlaceholderText('form.question.placeholder')
      ).toHaveValue('');
    });
  });

  it('does not render system-injected user fields and still submits normally', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        app: {
          id: 'uuid-1',
          instance_id: 'app-1',
          config: {
            dify_parameters: {
              user_input_form: [
                {
                  'text-input': {
                    variable: 'agentifui_user_id',
                    label: 'Injected User Id',
                    required: true,
                    default: '',
                  },
                },
              ],
            },
          },
        },
      }),
    } as Response);

    const onSubmit = jest.fn().mockResolvedValue({
      ok: true,
    });

    render(<ChatflowInputArea instanceId="app-1" onSubmit={onSubmit} />);

    const textarea = await screen.findByPlaceholderText(
      'form.question.placeholder'
    );
    expect(screen.queryByText('Injected User Id')).not.toBeInTheDocument();

    fireEvent.change(textarea, {
      target: {
        value: 'hello',
      },
    });

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'input.sendMessage' })
      ).not.toBeDisabled()
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'input.sendMessage',
      })
    );

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        'hello',
        {},
        [],
        undefined,
        expect.any(Function)
      );
    });
  });

  it('uses a required live file variable when native file_upload is disabled, without duplicating it in files', async () => {
    mockedFetch.mockImplementation(
      async url =>
        ({
          ok: true,
          json: async () =>
            String(url).includes('input-capabilities')
              ? {
                  ...ready,
                  attachmentSlots: [
                    {
                      key: 'Exact_File',
                      label: 'Required document',
                      target: 'inputs',
                      minCount: 1,
                      maxCount: 1,
                      methods: ['local_file'],
                      allowedTypes: ['image', 'document'],
                      extensions: [],
                      maxBytesByType: { image: 10, document: 10 },
                    },
                  ],
                }
              : {
                  success: true,
                  app: {
                    id: 'uuid-1',
                    instance_id: 'app-1',
                    config: {
                      dify_parameters: { file_upload: { enabled: false } },
                    },
                  },
                },
        }) as Response
    );
    jest
      .mocked(uploadDifyFile)
      .mockResolvedValue({ id: 'uploaded-md' } as never);
    const onSubmit = jest.fn().mockResolvedValue({ ok: true });
    const view = render(
      <ChatflowInputArea instanceId="app-1" onSubmit={onSubmit} />
    );
    const query = await screen.findByPlaceholderText(
      'form.question.placeholder'
    );
    fireEvent.change(query, { target: { value: 'read document' } });
    await screen.findByText('Required document * 0/1');
    expect(
      screen.getByRole('button', { name: 'input.sendMessage' })
    ).toBeDisabled();
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['doc'], 'doc.md', { type: '' })] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'input.sendMessage' })
      ).not.toBeDisabled()
    );
    fireEvent.click(screen.getByRole('button', { name: 'input.sendMessage' }));
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        'read document',
        {
          Exact_File: expect.objectContaining({
            upload_file_id: 'uploaded-md',
            type: 'document',
          }),
        },
        [],
        undefined,
        expect.any(Function)
      )
    );
  });
});
