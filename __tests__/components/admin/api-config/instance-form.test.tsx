import { InstanceForm } from '@components/admin/api-config/instance-form';
import {
  handleCreateInstance,
  handleUpdateInstance,
} from '@components/admin/api-config/instance-save-handlers';
import { TaskInputMapping } from '@components/admin/api-config/task-input-mapping';
import { validateDifyFormData } from '@lib/services/dify/validation';
import type { Provider } from '@lib/types/database';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

const mockTranslate = (key: string) => key;
const mockDiagnosticFetch = jest.fn();
const originalFetch = global.fetch;
const mockStore = {
  serviceInstances: [],
  apiKeys: [] as { service_instance_id: string }[],
  providers: [
    {
      id: 'provider',
      name: 'Agent service',
      base_url: 'https://agent.example.test',
      is_active: true,
    },
  ],
};

jest.mock('next-intl', () => ({
  useTranslations: (namespace: string) =>
    namespace.endsWith('.taskInput')
      ? (key: string, values?: { variable: string }) =>
          `taskInput.${key}${values ? ` ${values.variable}` : ''}`
      : mockTranslate,
}));
jest.mock('uuid', () => ({ v4: () => 'generated-instance' }));
jest.mock('@lib/stores/api-config-store', () => ({
  useApiConfigStore: () => mockStore,
}));
jest.mock('@lib/hooks/use-theme', () => ({
  useTheme: () => ({ isDark: false }),
}));
jest.mock('@lib/services/dify/validation', () => ({
  validateDifyFormData: jest.fn(() => []),
}));
jest.mock('@lib/services/dify/app-browser-service', () => ({
  getDifyAppInfo: jest.fn(async () => ({
    name: '',
    description: '',
    tags: [],
  })),
  getDifyAppParameters: jest.fn(async () => ({
    user_input_form: [
      {
        paragraph: {
          variable: 'SyncedText',
          label: 'Synced',
          required: false,
          default: '',
        },
      },
    ],
  })),
}));
jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
    warning: jest.fn(),
    success: jest.fn(),
    dismiss: jest.fn(),
  },
}));
jest.mock('@components/admin/api-config/dify-parameters-panel', () => ({
  __esModule: true,
  default: ({ onSave }: { onSave: (config: object) => void }) => (
    <div data-testid="dify-parameters">
      <button type="button" onClick={() => onSave({ user_input_form: [] })}>
        Save parameter fixture
      </button>
    </div>
  ),
}));
jest.mock('@components/admin/api-config/tags-selector', () => ({
  TagsSelector: () => null,
}));
jest.mock('@components/admin/api-config/instance-provider-card', () => ({
  InstanceProviderCard: () => null,
}));
jest.mock('@components/admin/api-config/dify-app-type-selector', () => ({
  DifyAppTypeSelector: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <select
      data-testid="dify-subtype"
      value={value}
      onChange={event => onChange(event.target.value)}
    >
      <option value="chatbot">chatbot</option>
      <option value="agent">agent</option>
    </select>
  ),
}));

const langchainInstance = {
  id: 'instance',
  provider_id: 'provider',
  instance_id: 'assistant',
  display_name: 'Assistant',
  config: {
    backend_type: 'langchain' as const,
    langchain: { assistant_id: 'agent' },
  },
};

function renderForm(instance = langchainInstance) {
  const onSave = jest.fn();
  const view = render(
    <InstanceForm
      instance={instance}
      isEditing
      onSave={onSave}
      onCancel={jest.fn()}
      isProcessing={false}
    />
  );
  return { ...view, onSave };
}

beforeEach(() => {
  jest.clearAllMocks();
  global.fetch = mockDiagnosticFetch;
  mockDiagnosticFetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      status: 'success',
      code: 'connected',
      capabilities: [],
    }),
  });
  mockStore.apiKeys = [{ service_instance_id: 'instance' }];
});
afterEach(() => {
  global.fetch = originalFetch;
});

describe.each(['dify', 'langchain'] as const)(
  '%s instance save credential normalization',
  backend => {
    const credentials = [
      ['  synthetic-key  ', 'synthetic-key'],
      ['   ', ''],
      ['', ''],
      [undefined, undefined],
    ] as const;

    it.each(credentials)(
      'normalizes both create arguments for draft key %p',
      async (apiKey, expectedKey) => {
        const data = {
          selectedProviderId: 'provider',
          apiKey,
          config: { backend_type: backend },
        };
        const addInstance = jest.fn().mockResolvedValue({ id: 'new-instance' });
        await handleCreateInstance(
          data,
          mockStore.providers as Provider[],
          addInstance,
          jest.fn(),
          jest.fn(),
          mockTranslate
        );
        expect(addInstance).toHaveBeenCalledTimes(1);
        expect(addInstance).toHaveBeenCalledWith(
          { ...data, provider_id: 'provider', apiKey: expectedKey },
          expectedKey
        );
        expect(data.apiKey).toBe(apiKey);
      }
    );

    it.each(credentials)(
      'normalizes both edit arguments for draft key %p',
      async (apiKey, expectedKey) => {
        const data = { apiKey, config: { backend_type: backend } };
        const updateInstance = jest.fn().mockResolvedValue({ id: 'instance' });
        await handleUpdateInstance(
          { id: 'instance' },
          data,
          updateInstance,
          jest.fn(),
          jest.fn(),
          mockTranslate
        );
        expect(updateInstance).toHaveBeenCalledTimes(1);
        expect(updateInstance).toHaveBeenCalledWith(
          'instance',
          { ...data, apiKey: expectedKey },
          expectedKey
        );
        expect(data.apiKey).toBe(apiKey);
      }
    );
  }
);

describe('task input mapping in the existing instance form', () => {
  const taskInstance = {
    ...langchainInstance,
    config: {
      backend_type: 'dify' as const,
      api_url: 'https://agent.example.test',
      app_metadata: {
        app_type: 'marketplace' as const,
        dify_apptype: 'workflow' as const,
      },
      dify_parameters: {
        user_input_form: [
          {
            paragraph: {
              variable: 'ExactText',
              label: 'Main text',
              required: true,
              default: '',
            },
          },
          {
            'text-input': {
              variable: 'Context',
              label: 'Context',
              required: false,
              default: '',
            },
          },
          {
            select: {
              variable: 'Choice',
              label: 'Choice',
              required: false,
              default: '',
              options: [],
            },
          },
        ],
      },
    },
  };

  function renderTask(task_input?: { text_variable: string | null }) {
    const onSave = jest.fn();
    const view = render(
      <InstanceForm
        instance={{
          ...taskInstance,
          config: {
            ...taskInstance.config,
            ...(task_input ? { task_input } : {}),
          },
        }}
        isEditing
        onSave={onSave}
        onCancel={jest.fn()}
        isProcessing={false}
      />
    );
    return { ...view, onSave };
  }

  it('offers only exact free-text fields and saves explicit, parameters-only, and automatic choices', () => {
    const { container, onSave } = renderTask();
    const select = screen.getByLabelText('taskInput.label');
    expect(select).toHaveValue('auto');
    expect(screen.getByText(/ambiguous/)).toBeInTheDocument();
    expect(
      screen.queryByRole('option', { name: 'Choice (Choice)' })
    ).not.toBeInTheDocument();
    fireEvent.change(select, {
      target: { value: JSON.stringify('ExactText') },
    });
    expect(screen.getByText(/explicitResolved/)).toBeInTheDocument();
    fireEvent.submit(container.querySelector('form')!);
    expect(onSave.mock.calls.at(-1)[0].config.task_input).toEqual({
      text_variable: 'ExactText',
    });
    fireEvent.change(select, { target: { value: 'null' } });
    expect(screen.getByText(/parametersOnlyNote/)).toBeInTheDocument();
    fireEvent.submit(container.querySelector('form')!);
    expect(onSave.mock.calls.at(-1)[0].config.task_input).toEqual({
      text_variable: null,
    });
    fireEvent.change(select, { target: { value: 'auto' } });
    fireEvent.submit(container.querySelector('form')!);
    expect(onSave.mock.calls.at(-1)[0].config).not.toHaveProperty('task_input');
  });

  it.each([null, 'ExactText'])(
    'preserves custom task mapping %p across parameter sync and save',
    async text_variable => {
      const { container, onSave } = renderTask({ text_variable });
      fireEvent.click(screen.getByRole('button', { name: 'syncConfig' }));
      await waitFor(() =>
        expect(
          screen.getByRole('option', { name: 'Synced (SyncedText)' })
        ).toBeInTheDocument()
      );
      expect(screen.getByLabelText('taskInput.label')).toHaveValue(
        JSON.stringify(text_variable)
      );
      if (text_variable !== null)
        expect(screen.getByText(/invalid /)).toBeInTheDocument();
      fireEvent.submit(container.querySelector('form')!);
      expect(onSave.mock.calls.at(-1)[0].config.task_input).toEqual({
        text_variable,
      });
      expect(
        onSave.mock.calls.at(-1)[0].config.dify_parameters.user_input_form[0]
          .paragraph.variable
      ).toBe('SyncedText');
    }
  );

  it('retains a stale explicit mapping visibly instead of silently switching to automatic', () => {
    renderTask({ text_variable: 'stale' });
    expect(screen.getByLabelText('taskInput.label')).toHaveValue(
      JSON.stringify('stale')
    );
    expect(screen.getByText(/invalid /)).toBeInTheDocument();
  });

  it.each([null, 'ExactText'])(
    'retains task mapping %p when saving the existing parameter panel',
    text_variable => {
      const { container, onSave } = renderTask({ text_variable });
      fireEvent.click(
        screen.getByRole('button', { name: 'Save parameter fixture' })
      );
      fireEvent.submit(container.querySelector('form')!);
      expect(onSave.mock.calls.at(-1)[0].config.task_input).toEqual({
        text_variable,
      });
      expect(
        onSave.mock.calls.at(-1)[0].config.dify_parameters.user_input_form
      ).toEqual([]);
    }
  );

  it.each(['workflow', 'text-generation'] as const)(
    'shows resolved automatic mapping for a sole free-text field in %s',
    dify_apptype => {
      render(
        <InstanceForm
          instance={{
            ...taskInstance,
            config: {
              ...taskInstance.config,
              app_metadata: {
                ...taskInstance.config.app_metadata,
                dify_apptype,
              },
              dify_parameters: {
                user_input_form:
                  taskInstance.config.dify_parameters.user_input_form.slice(
                    0,
                    1
                  ),
              },
            },
          }}
          isEditing
          onSave={jest.fn()}
          onCancel={jest.fn()}
          isProcessing={false}
        />
      );
      expect(
        screen.getByText(/taskInput.autoResolved ExactText/)
      ).toBeInTheDocument();
    }
  );

  it('explains zero-text schemas and disables the control during save or sync', () => {
    render(
      <TaskInputMapping
        config={{
          api_url: '',
          app_metadata: { app_type: 'marketplace', tags: [] },
          dify_parameters: {},
        }}
        disabled
        onChange={jest.fn()}
      />
    );
    expect(screen.getByLabelText('taskInput.label')).toBeDisabled();
    expect(screen.getByText(/taskInput.noText/)).toBeInTheDocument();
  });

  it.each(['auto', 'null', 'query', 'Exact.Case'])(
    'keeps the exact field %p distinct from selector modes',
    variable => {
      const onChange = jest.fn();
      render(
        <TaskInputMapping
          config={{
            api_url: '',
            app_metadata: { app_type: 'marketplace', tags: [] },
            dify_parameters: {
              user_input_form: [
                {
                  paragraph: {
                    variable,
                    label: 'Field',
                    required: false,
                    default: '',
                  },
                },
              ],
            },
          }}
          disabled={false}
          onChange={onChange}
        />
      );
      fireEvent.change(screen.getByLabelText('taskInput.label'), {
        target: { value: JSON.stringify(variable) },
      });
      expect(onChange).toHaveBeenCalledWith({ text_variable: variable });
    }
  );
});

describe('LangChain admin instance form', () => {
  it.each([false, true])(
    'places the configuration check immediately after the sync action when editing is %s',
    isEditing => {
      render(
        <InstanceForm
          instance={
            isEditing
              ? {
                  ...langchainInstance,
                  config: {
                    ...langchainInstance.config,
                    backend_type: 'dify',
                  },
                }
              : null
          }
          isEditing={isEditing}
          onSave={jest.fn()}
          onCancel={jest.fn()}
          isProcessing={false}
        />
      );
      const check = screen.getByRole('button', { name: 'check' });
      const sync = screen.getByRole('button', { name: 'syncConfig' });
      const actions = Array.from(
        check.parentElement!.querySelectorAll('button')
      );
      expect(actions.findIndex(action => action === check)).toBe(
        actions.findIndex(action => action === sync) + 1
      );
    }
  );

  it.each(['dify', 'langchain'] as const)(
    'places the %s diagnostic in the top action row outside the save form',
    backend => {
      const { container } = render(
        <InstanceForm
          instance={{
            ...langchainInstance,
            config: { ...langchainInstance.config, backend_type: backend },
          }}
          isEditing
          onSave={jest.fn()}
          onCancel={jest.fn()}
          isProcessing={false}
        />
      );
      const button = screen.getByRole('button', { name: 'check' });
      const form = container.querySelector('form')!;
      expect(form.contains(button)).toBe(false);
      expect(
        button.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy();
      expect(button).toHaveAttribute('type', 'button');
      if (backend === 'dify') {
        expect(button.parentElement).toContainElement(
          screen.getByRole('button', { name: 'defaultApp.setAsDefault' })
        );
        expect(button.parentElement).toContainElement(
          screen.getByRole('button', { name: 'difyConfig.title' })
        );
      } else {
        expect(screen.queryByText('difyConfig.title')).not.toBeInTheDocument();
        expect(
          screen.queryByText('defaultApp.setAsDefault')
        ).not.toBeInTheDocument();
      }
    }
  );

  it.each([false, true])(
    'binds diagnostics to the selected provider and edit identity: %s',
    async isEditing => {
      const onSave = jest.fn();
      render(
        <InstanceForm
          instance={isEditing ? langchainInstance : null}
          isEditing={isEditing}
          onSave={onSave}
          onCancel={jest.fn()}
          isProcessing={false}
        />
      );
      if (!isEditing) {
        fireEvent.change(screen.getByLabelText('backend.label'), {
          target: { value: 'langchain' },
        });
        fireEvent.change(screen.getByLabelText('apiKey *'), {
          target: { value: 'draft-key' },
        });
      }
      fireEvent.change(screen.getByLabelText('backend.assistantId'), {
        target: { value: '  updated-agent  ' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'check' }));
      await screen.findByText('codes.connected');
      expect(JSON.parse(mockDiagnosticFetch.mock.calls[0][1].body)).toEqual({
        providerId: 'provider',
        backend: 'langchain',
        assistantId: 'updated-agent',
        ...(isEditing
          ? { serviceInstanceId: 'instance' }
          : { apiKey: 'draft-key' }),
      });
      expect(onSave).not.toHaveBeenCalled();
    }
  );

  it('defaults new apps to Dify and creates LangChain through the existing credential field', () => {
    const onSave = jest.fn();
    const { container } = render(
      <InstanceForm
        instance={null}
        isEditing={false}
        onSave={onSave}
        onCancel={jest.fn()}
        isProcessing={false}
      />
    );
    expect(screen.getByLabelText('backend.label')).toHaveValue('dify');
    fireEvent.change(screen.getByLabelText('backend.label'), {
      target: { value: 'langchain' },
    });
    fireEvent.change(
      screen.getByPlaceholderText('fields.instanceId.placeholder'),
      { target: { value: 'new-assistant' } }
    );
    fireEvent.change(
      screen.getByPlaceholderText('fields.displayName.placeholder'),
      { target: { value: 'New assistant' } }
    );
    fireEvent.change(screen.getByLabelText('apiKey *'), {
      target: { value: 'test-credential' },
    });
    expect(screen.queryByText('sync.syncFromDify')).not.toBeInTheDocument();
    fireEvent.submit(container.querySelector('form')!);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedProviderId: 'provider',
        apiKey: 'test-credential',
        setAsDefault: false,
        config: expect.objectContaining({
          backend_type: 'langchain',
          langchain: { assistant_id: 'agent' },
        }),
      })
    );
    expect(onSave.mock.calls[0][0].config).not.toHaveProperty('apiKey');
    expect(validateDifyFormData).not.toHaveBeenCalled();
  });

  it('shows the assistant field and hides Dify-only/default-model controls', () => {
    renderForm();
    expect(screen.getByLabelText('backend.label')).toHaveValue('langchain');
    expect(screen.getByLabelText('backend.assistantId')).toHaveValue('agent');
    expect(screen.queryByTestId('dify-subtype')).not.toBeInTheDocument();
    expect(screen.queryByTestId('dify-parameters')).not.toBeInTheDocument();
    expect(screen.queryByText('difyConfig.title')).not.toBeInTheDocument();
    expect(
      screen.queryByText('defaultApp.setAsDefault')
    ).not.toBeInTheDocument();
    expect(screen.queryByText('appType.label')).not.toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('fields.description.placeholder')
    ).toBeInTheDocument();
  });

  it('submits a marketplace config without invoking Dify validation', () => {
    const { container, onSave } = renderForm();
    fireEvent.change(screen.getByLabelText('backend.assistantId'), {
      target: { value: ' custom-agent ' },
    });
    fireEvent.submit(container.querySelector('form')!);
    expect(validateDifyFormData).not.toHaveBeenCalled();
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        setAsDefault: false,
        is_default: false,
        config: {
          backend_type: 'langchain',
          api_url: 'https://agent.example.test',
          langchain: { assistant_id: 'custom-agent' },
          app_metadata: {
            app_type: 'marketplace',
            is_marketplace_app: true,
            tags: [],
          },
        },
      })
    );
  });

  it('rejects an empty assistant ID and a missing credential instead of silently defaulting', () => {
    mockStore.apiKeys = [];
    const { container, onSave } = renderForm();
    fireEvent.change(screen.getByLabelText('backend.assistantId'), {
      target: { value: '   ' },
    });
    fireEvent.submit(container.querySelector('form')!);
    expect(onSave).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      'validation.formValidationFailed',
      {
        description: expect.stringContaining(
          'backend.validation.assistantIdRequired'
        ),
      }
    );
    fireEvent.change(screen.getByLabelText('backend.assistantId'), {
      target: { value: 'agent' },
    });
    fireEvent.submit(container.querySelector('form')!);
    expect(onSave).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenLastCalledWith(
      'validation.formValidationFailed',
      {
        description: 'validation.fillApiCredentials',
      }
    );
  });

  it('switches back to Dify with its original controls and validation path', () => {
    const { container, onSave } = renderForm();
    fireEvent.change(screen.getByLabelText('backend.label'), {
      target: { value: 'dify' },
    });
    expect(
      screen.queryByLabelText('backend.assistantId')
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('dify-subtype')).toBeInTheDocument();
    expect(screen.getByTestId('dify-parameters')).toBeInTheDocument();
    expect(screen.getByText('defaultApp.setAsDefault')).toBeInTheDocument();
    fireEvent.submit(container.querySelector('form')!);
    expect(validateDifyFormData).toHaveBeenCalled();
    expect(onSave.mock.calls[0][0].config).not.toHaveProperty('langchain');
  });

  it('defaults the public chatbot opt-in off and explains the text-only capability checks', () => {
    const { container, onSave } = renderForm();
    fireEvent.change(screen.getByLabelText('backend.label'), {
      target: { value: 'dify' },
    });
    const checkbox = screen.getByRole('checkbox', {
      name: 'backend.aguiLabel',
    });
    expect(checkbox).not.toBeChecked();
    expect(checkbox).toHaveAttribute(
      'aria-describedby',
      'interaction-protocol-note'
    );
    expect(screen.getByText('backend.aguiNote')).toBeInTheDocument();
    fireEvent.click(checkbox);
    fireEvent.submit(container.querySelector('form')!);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        config: expect.objectContaining({ interaction_protocol: 'ag-ui/1.0' }),
      })
    );
    fireEvent.click(checkbox);
    fireEvent.submit(container.querySelector('form')!);
    expect(
      onSave.mock.calls[onSave.mock.calls.length - 1][0].config
    ).not.toHaveProperty('interaction_protocol');
  });

  it('clears the checkbox when leaving chatbot and does not opt in again on return', () => {
    renderForm();
    expect(screen.queryByText('backend.aguiLabel')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('backend.label'), {
      target: { value: 'dify' },
    });
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'backend.aguiLabel' })
    );
    fireEvent.change(screen.getByTestId('dify-subtype'), {
      target: { value: 'agent' },
    });
    expect(screen.queryByText('backend.aguiLabel')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('dify-subtype'), {
      target: { value: 'chatbot' },
    });
    expect(
      screen.getByRole('checkbox', { name: 'backend.aguiLabel' })
    ).not.toBeChecked();
  });

  it('only offers marketplace chatbot opt-in and clears it when changing to a model', () => {
    render(
      <InstanceForm
        instance={null}
        isEditing={false}
        onSave={jest.fn()}
        onCancel={jest.fn()}
        isProcessing={false}
      />
    );
    expect(
      screen.queryByRole('checkbox', { name: 'backend.aguiLabel' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('appType.marketplace.title'));
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'backend.aguiLabel' })
    );
    fireEvent.click(screen.getByText('appType.model.title'));
    expect(
      screen.queryByRole('checkbox', { name: 'backend.aguiLabel' })
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('appType.marketplace.title'));
    expect(
      screen.getByRole('checkbox', { name: 'backend.aguiLabel' })
    ).not.toBeChecked();
  });
});
