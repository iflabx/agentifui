import { AppRequestError } from '@lib/errors/app-error';
import { uploadDifyFile } from '@lib/services/dify/file-service';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ChatflowInputArea } from './chatflow-input-area';

const showNotification = jest.fn();
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
    loading: false,
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

describe('ChatflowInputArea moderation handling', () => {
  const originalFetch = global.fetch;
  const mockedFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    useChatInputStore.getState().setActor('actor');
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

    fireEvent.click(
      screen.getByRole('button', {
        name: 'form.startConversation',
      })
    );

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('unsafe message', {}, []);
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

    fireEvent.click(
      screen.getByRole('button', {
        name: 'form.startConversation',
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

    fireEvent.click(
      screen.getByRole('button', {
        name: 'form.startConversation',
      })
    );

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith('hello', {}, []);
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
    expect(screen.getByText('Required document')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'form.startConversation' })
    ).toBeDisabled();
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File(['doc'], 'doc.md', { type: '' })] },
    });
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'form.startConversation' })
      ).not.toBeDisabled()
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'form.startConversation' })
    );
    await waitFor(() =>
      expect(onSubmit).toHaveBeenCalledWith(
        'read document',
        {
          Exact_File: expect.objectContaining({
            upload_file_id: 'uploaded-md',
            type: 'document',
          }),
        },
        []
      )
    );
  });
});
