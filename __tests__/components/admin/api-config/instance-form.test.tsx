import { InstanceForm } from '@components/admin/api-config/instance-form';
import { validateDifyFormData } from '@lib/services/dify/validation';
import { fireEvent, render, screen } from '@testing-library/react';
import { toast } from 'sonner';

const mockTranslate = (key: string) => key;
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

jest.mock('next-intl', () => ({ useTranslations: () => mockTranslate }));
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
jest.mock('sonner', () => ({
  toast: { error: jest.fn(), warning: jest.fn(), success: jest.fn() },
}));
jest.mock('@components/admin/api-config/dify-parameters-panel', () => ({
  __esModule: true,
  default: () => <div data-testid="dify-parameters" />,
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
  mockStore.apiKeys = [{ service_instance_id: 'instance' }];
});

describe('LangChain admin instance form', () => {
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
