import { uploadDifyFile } from '@lib/services/dify/file-service';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { WorkflowInputForm } from '.';
import type { AgentInputCapabilities } from '../../../packages/shared/src/agent-input';

jest.mock('@lib/services/dify/file-service', () => ({
  uploadDifyFile: jest.fn(),
}));

jest.mock('@lib/hooks/use-mobile', () => ({ useMobile: () => false }));

const ready: AgentInputCapabilities = {
  version: 1,
  status: 'ready',
  mode: 'task',
  text: { enabled: false, required: false, target: 'query' },
  fields: [],
  attachmentSlots: [],
};
jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => ({
    session: { user: { id: 'actor' } },
    loading: false,
  }),
}));

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('WorkflowInputForm system-injected fields', () => {
  const originalFetch = global.fetch;
  const mockedFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockedFetch;
    useChatInputStore.getState().setActor('actor');
    mockedFetch.mockResolvedValue({
      ok: true,
      json: async () => ready,
    } as Response);
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it.each(['workflow', 'completion'])(
    'uses the shared introduction, composer and native file payload for %s',
    async type => {
      const capabilities: AgentInputCapabilities = {
        ...ready,
        text: { enabled: true, required: true, target: 'prompt' },
        fields: [
          { key: 'prompt', label: 'Prompt', type: 'paragraph', required: true },
          {
            key: 'language',
            label: 'Language',
            type: 'text-input',
            required: true,
            default: 'English',
          },
        ],
        attachmentSlots: [
          {
            key: 'document',
            label: 'Document',
            target: 'inputs',
            minCount: 1,
            maxCount: 1,
            methods: ['local_file'],
            allowedTypes: ['document'],
            extensions: ['txt'],
            maxBytesByType: { document: 100 },
          },
        ],
      };
      mockedFetch.mockImplementation(
        async url =>
          ({
            ok: true,
            json: async () =>
              String(url).includes('input-capabilities')
                ? capabilities
                : {
                    success: true,
                    app: {
                      id: 'uuid-1',
                      instance_id: 'app-1',
                      display_name: 'Task name',
                      description: 'Configured task description',
                      config: { app_metadata: { dify_apptype: type } },
                    },
                  },
          }) as Response
      );
      jest
        .mocked(uploadDifyFile)
        .mockResolvedValue({ id: 'native-upload' } as never);
      const onExecute = jest.fn().mockResolvedValue(true);
      const view = render(
        <WorkflowInputForm
          instanceId="app-1"
          onExecute={onExecute}
          isExecuting={false}
          chat
          showIntroduction
        />
      );
      await screen.findByText('Configured task description');
      expect(screen.getByText('Task name')).toBeInTheDocument();
      expect(screen.queryByText('independent')).not.toBeInTheDocument();
      const composer = screen.getByRole('textbox', {
        name: 'input.placeholder',
      });
      expect(composer).toHaveAttribute('placeholder', '');
      fireEvent.change(composer, { target: { value: 'Summarize' } });
      const send = screen.getByRole('button', { name: 'startExecution' });
      expect(send).toBeDisabled();
      const input =
        view.container.querySelector<HTMLInputElement>('input[type=file]')!;
      expect(input.closest('[data-chat-input-container]')).not.toBeNull();
      const click = jest
        .spyOn(input, 'click')
        .mockImplementation(() => undefined);
      fireEvent.click(
        screen.getByRole('button', { name: 'fileTypeSelector.ariaLabel' })
      );
      expect(click).toHaveBeenCalledTimes(1);
      fireEvent.change(input, {
        target: {
          files: [new File(['note'], 'notes.txt', { type: 'text/plain' })],
        },
      });
      await waitFor(() => expect(send).not.toBeDisabled());
      expect(
        screen.getByRole('button', { name: 'fileTypeSelector.ariaLabel' })
      ).toBeDisabled();
      expect(screen.getByText('notes.txt')).toBeInTheDocument();
      fireEvent.click(send);
      await waitFor(() => expect(onExecute).toHaveBeenCalledTimes(1));
      expect(onExecute).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Summarize',
          language: 'English',
          document: expect.objectContaining({
            upload_file_id: 'native-upload',
            app_id: 'app-1',
            actor_id: 'actor',
          }),
        })
      );
      view.rerender(
        <WorkflowInputForm
          instanceId="app-1"
          onExecute={onExecute}
          isExecuting={false}
          chat
          showIntroduction={false}
        />
      );
      expect(
        screen.queryByText('Configured task description')
      ).not.toBeInTheDocument();
      expect(screen.getByDisplayValue('English')).toBeInTheDocument();
      expect(screen.getByText('notes.txt')).toBeInTheDocument();
    }
  );

  it('can submit an attachment-only task with the shared composer', async () => {
    const capabilities: AgentInputCapabilities = {
      ...ready,
      attachmentSlots: [
        {
          key: 'document',
          label: 'Document',
          target: 'inputs',
          minCount: 1,
          maxCount: 1,
          methods: ['local_file'],
          allowedTypes: ['document'],
          extensions: ['txt'],
          maxBytesByType: { document: 100 },
        },
      ],
    };
    mockedFetch.mockImplementation(
      async url =>
        ({
          ok: true,
          json: async () =>
            String(url).includes('input-capabilities')
              ? capabilities
              : {
                  success: true,
                  app: { id: 'uuid-1', instance_id: 'app-1', config: {} },
                },
        }) as Response
    );
    jest
      .mocked(uploadDifyFile)
      .mockResolvedValue({ id: 'native-upload' } as never);
    const onExecute = jest.fn().mockResolvedValue(true);
    const view = render(
      <WorkflowInputForm
        instanceId="app-1"
        onExecute={onExecute}
        isExecuting={false}
        chat
      />
    );
    const attach = await screen.findByRole('button', {
      name: 'fileTypeSelector.ariaLabel',
    });
    await waitFor(() => expect(attach).not.toBeDisabled());
    expect(screen.getByRole('textbox')).toBeDisabled();
    fireEvent.change(view.container.querySelector('input[type=file]')!, {
      target: { files: [new File(['note'], 'notes.txt')] },
    });
    const send = screen.getByRole('button', { name: 'startExecution' });
    await waitFor(() => expect(send).not.toBeDisabled());
    fireEvent.click(send);
    await waitFor(() =>
      expect(onExecute).toHaveBeenCalledWith({
        document: expect.objectContaining({ upload_file_id: 'native-upload' }),
      })
    );
  });

  it('uploads a file dropped on the composer through its native field and keeps its payload', async () => {
    const capabilities: AgentInputCapabilities = {
      ...ready,
      attachmentSlots: [
        {
          key: 'document',
          label: 'Document',
          target: 'inputs',
          minCount: 1,
          maxCount: 1,
          methods: ['local_file'],
          allowedTypes: ['document'],
          extensions: ['txt'],
          maxBytesByType: { document: 100 },
        },
      ],
    };
    mockedFetch.mockImplementation(
      async url =>
        ({
          ok: true,
          json: async () =>
            String(url).includes('input-capabilities')
              ? capabilities
              : {
                  success: true,
                  app: { id: 'uuid-1', instance_id: 'app-1', config: {} },
                },
        }) as Response
    );
    jest
      .mocked(uploadDifyFile)
      .mockResolvedValue({ id: 'dropped-upload' } as never);
    const onExecute = jest.fn().mockResolvedValue(true);
    const props = {
      instanceId: 'app-1',
      onExecute,
      isExecuting: false,
      chat: true,
    };
    const view = render(<WorkflowInputForm {...props} />);
    const attach = await screen.findByRole('button', {
      name: 'fileTypeSelector.ariaLabel',
    });
    await waitFor(() => expect(attach).toBeEnabled());
    const composer = screen.getByRole('textbox');
    const drop = (name = 'notes.txt') =>
      fireEvent.drop(composer, {
        dataTransfer: {
          types: ['Files'],
          files: [new File(['note'], name, { type: 'text/plain' })],
        },
      });
    expect(drop('wrong.exe')).toBe(false);
    expect(uploadDifyFile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'fileUpload.unsupportedFormat'
    );
    expect(drop()).toBe(false);
    await waitFor(() => expect(uploadDifyFile).toHaveBeenCalledTimes(1));
    expect(uploadDifyFile).toHaveBeenCalledWith(
      'app-1',
      expect.any(File),
      'actor'
    );
    const send = screen.getByRole('button', { name: 'startExecution' });
    await waitFor(() => expect(send).toBeEnabled());
    expect(drop()).toBe(false);
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'fileTypeSelector.maxFilesReached'
    );
    fireEvent.click(send);
    await waitFor(() =>
      expect(onExecute).toHaveBeenCalledWith({
        document: expect.objectContaining({
          upload_file_id: 'dropped-upload',
          actor_id: 'actor',
          app_id: 'app-1',
        }),
      })
    );
    view.rerender(<WorkflowInputForm {...props} isExecuting />);
    expect(drop()).toBe(false);
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
  });

  it.each(['multiple', 'unsupported', 'unavailable'])(
    'prevents file-drop navigation and explains %s attachment targets without guessing',
    async scenario => {
      const slot = {
        key: 'source',
        label: 'Source',
        target: 'inputs' as const,
        minCount: 0,
        maxCount: 1,
        methods: ['local_file' as const],
        allowedTypes: ['document' as const],
        extensions: ['txt'],
        maxBytesByType: { document: 100 },
      };
      const capabilities: AgentInputCapabilities = {
        ...ready,
        status: scenario === 'unavailable' ? 'unavailable' : 'ready',
        attachmentSlots:
          scenario === 'multiple'
            ? [slot, { ...slot, key: 'reference', label: 'Reference' }]
            : [],
      };
      mockedFetch.mockImplementation(
        async url =>
          ({
            ok: true,
            json: async () =>
              String(url).includes('input-capabilities')
                ? capabilities
                : {
                    success: true,
                    app: { id: 'uuid-1', instance_id: 'app-1', config: {} },
                  },
          }) as Response
      );
      render(
        <WorkflowInputForm
          instanceId="app-1"
          onExecute={jest.fn()}
          isExecuting={false}
          chat
        />
      );
      await screen.findByRole('button', { name: 'fileTypeSelector.ariaLabel' });
      await waitFor(() =>
        expect(mockedFetch).toHaveBeenCalledWith(
          expect.stringContaining('input-capabilities'),
          expect.anything()
        )
      );
      const composer = screen.getByRole('textbox');
      const event = {
        dataTransfer: {
          types: ['Files'],
          files: [new File(['note'], 'notes.txt')],
        },
      };
      expect(fireEvent.dragOver(composer, event)).toBe(false);
      expect(fireEvent.drop(composer, event)).toBe(false);
      expect(uploadDifyFile).not.toHaveBeenCalled();
      const message =
        scenario === 'multiple'
          ? 'input.chooseAttachmentField'
          : scenario === 'unsupported'
            ? 'fileTypeSelector.notSupported'
            : 'input.capabilitiesUnavailable';
      expect(screen.getAllByText(message).length).toBeGreaterThan(0);
      expect(
        fireEvent.drop(composer, {
          dataTransfer: { types: ['text/plain'], files: [] },
        })
      ).toBe(true);
    }
  );

  it('hides system-injected user fields and still allows execution', async () => {
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

    const onExecute = jest.fn().mockResolvedValue(undefined);

    render(
      <WorkflowInputForm
        instanceId="app-1"
        onExecute={onExecute}
        isExecuting={false}
      />
    );

    expect(
      await screen.findByRole('button', { name: 'startExecution' })
    ).toBeInTheDocument();
    expect(screen.queryByText('Injected User Id')).not.toBeInTheDocument();
    expect(screen.queryByText('noFormConfig')).not.toBeInTheDocument();

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'startExecution' })
      ).not.toBeDisabled()
    );
    fireEvent.click(
      screen.getByRole('button', {
        name: 'startExecution',
      })
    );

    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith({});
    });
    expect(fetch).toHaveBeenCalledWith(
      '/api/internal/apps/uuid-1/input-capabilities',
      expect.objectContaining({ credentials: 'include' })
    );
  });

  it.each(['throw', 'result'])(
    'blocks unavailable requirements after %s failure and preserves fields',
    async failure => {
      let calls = 0;
      const capability = {
        ...ready,
        fields: [
          {
            key: 'Exact_Key',
            label: 'Prompt',
            type: 'text-input',
            required: true,
          },
        ],
      };
      mockedFetch.mockImplementation(async url => {
        if (String(url).includes('input-capabilities')) {
          calls += 1;
          return {
            ok: true,
            json: async () =>
              calls === 2 ? { ...ready, status: 'unavailable' } : capability,
          } as Response;
        }
        return {
          ok: true,
          json: async () => ({
            success: true,
            app: { id: 'uuid-1', instance_id: 'app-1', config: {} },
          }),
        } as Response;
      });
      const onExecute =
        failure === 'throw'
          ? jest.fn().mockRejectedValueOnce(new Error('upstream changed'))
          : jest.fn().mockResolvedValueOnce(false);
      render(
        <WorkflowInputForm
          instanceId="app-1"
          onExecute={onExecute}
          isExecuting={false}
        />
      );
      const input = await screen.findByRole('textbox');
      fireEvent.change(input, { target: { value: 'preserve draft' } });
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'startExecution' })
        ).not.toBeDisabled()
      );
      fireEvent.click(screen.getByRole('button', { name: 'startExecution' }));
      await screen.findByText('input.capabilitiesUnavailable');
      expect(screen.getByRole('textbox')).toHaveValue('preserve draft');
      expect(
        screen.getByRole('button', { name: 'startExecution' })
      ).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: 'ui.retry' }));
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: 'startExecution' })
        ).not.toBeDisabled()
      );
      expect(screen.getByRole('textbox')).toHaveValue('preserve draft');
      expect(onExecute).toHaveBeenCalledWith({ Exact_Key: 'preserve draft' });
    }
  );
});
