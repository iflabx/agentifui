import { ProviderForm } from '@components/admin/api-config/provider-management/provider-form';
import type { Provider } from '@lib/types/database';
import { fireEvent, render, screen } from '@testing-library/react';

const mockTranslate = Object.assign((key: string) => key, {
  has: () => false,
});

jest.mock('next-intl', () => ({ useTranslations: () => mockTranslate }));
jest.mock('@lib/hooks/use-theme', () => ({
  useTheme: () => ({ isDark: false }),
}));

beforeAll(() => {
  HTMLElement.prototype.scrollIntoView = jest.fn();
  HTMLElement.prototype.hasPointerCapture = jest.fn(() => false);
});

const provider: Provider = {
  id: 'provider-id',
  name: 'Agent platform',
  type: 'langchain',
  base_url: 'https://agent.example.test',
  auth_type: 'api_key',
  is_active: true,
  is_default: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

function openProviderTypes() {
  fireEvent.keyDown(screen.getByRole('combobox', { name: /form.type.label/ }), {
    key: ' ',
    code: 'Space',
  });
}

describe('provider management form', () => {
  it.each([
    ['dify', 'Dify'],
    ['langchain', 'LangChain'],
  ])('offers and submits %s when creating a provider', (type, label) => {
    const onSave = jest.fn();
    const { container } = render(
      <ProviderForm isCreating onSave={onSave} onCancel={jest.fn()} />
    );

    expect(
      screen.getByRole('combobox', { name: /form.type.label/ })
    ).toHaveTextContent('Dify');
    fireEvent.change(screen.getByLabelText(/form.name.label/), {
      target: { value: 'New platform' },
    });
    fireEvent.change(screen.getByLabelText(/form.baseUrl.label/), {
      target: { value: 'https://agent.example.test' },
    });
    openProviderTypes();
    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'Dify' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'LangChain' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: label }));
    fireEvent.submit(container.querySelector('form')!);

    expect(onSave).toHaveBeenCalledWith({
      name: 'New platform',
      type,
      base_url: 'https://agent.example.test',
      auth_type: 'api_key',
      is_active: true,
      is_default: false,
    });
  });

  it('offers both platforms while preserving an existing LangChain provider', () => {
    const onSave = jest.fn();
    const { container } = render(
      <ProviderForm provider={provider} onSave={onSave} onCancel={jest.fn()} />
    );
    expect(
      screen.getByRole('combobox', { name: /form.type.label/ })
    ).toHaveTextContent('LangChain');
    openProviderTypes();
    expect(screen.getByRole('option', { name: 'Dify' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: 'LangChain' }));
    fireEvent.submit(container.querySelector('form')!);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'langchain',
        base_url: provider.base_url,
      })
    );
  });

  it.each([
    ['llm', 'LLM'],
    ['custom_platform', 'Custom Platform'],
  ])('preserves the existing legacy type %s when editing', (type, label) => {
    const onSave = jest.fn();
    const { container } = render(
      <ProviderForm
        provider={{ ...provider, type }}
        onSave={onSave}
        onCancel={jest.fn()}
      />
    );
    openProviderTypes();
    expect(screen.getAllByRole('option')).toHaveLength(3);
    expect(screen.getByRole('option', { name: 'Dify' })).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: 'LangChain' })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: label }));
    fireEvent.submit(container.querySelector('form')!);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ type }));
  });
});
