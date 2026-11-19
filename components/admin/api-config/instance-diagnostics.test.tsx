import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';

import { InstanceDiagnostics } from './instance-diagnostics';
import { createEmptyInstanceFormData } from './instance-form-utils';

jest.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
const originalFetch = global.fetch;
const fetchMock = jest.fn();
const success = {
  status: 'success',
  code: 'connected',
  capabilities: ['text'],
};
const draft = () => ({
  ...createEmptyInstanceFormData(),
  apiKey: 'synthetic-key',
});
const props = () => ({
  formData: draft(),
  providerId: 'provider',
  disabled: false,
});
beforeEach(() => {
  global.fetch = fetchMock;
  fetchMock.mockReset();
});
afterEach(() => {
  global.fetch = originalFetch;
});

it('is unchecked until explicitly triggered and never submits the form', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => success });
  const onSubmit = jest.fn();
  render(
    <form onSubmit={onSubmit}>
      <InstanceDiagnostics {...props()} />
    </form>
  );
  expect(screen.getByText('unchecked')).toBeInTheDocument();
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'check' }));
  await screen.findByText('codes.connected');
  expect(onSubmit).not.toHaveBeenCalled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [url, request] = fetchMock.mock.calls[0];
  expect(url).toBe('/api/admin/app-diagnostics');
  expect(JSON.parse(request.body)).toEqual({
    providerId: 'provider',
    backend: 'dify',
    apiKey: 'synthetic-key',
  });
  expect(request.body).not.toContain('api_url');
});

it('invalidates a successful check after config edits, even if reverted', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => success });
  const currentProps = props();
  const { rerender } = render(<InstanceDiagnostics {...currentProps} />);
  fireEvent.click(screen.getByRole('button', { name: 'check' }));
  await screen.findByText('codes.connected');
  rerender(
    <InstanceDiagnostics
      {...currentProps}
      formData={{ ...currentProps.formData, apiKey: 'changed-key' }}
    />
  );
  expect(screen.getByText('stale')).toBeInTheDocument();
  rerender(<InstanceDiagnostics {...currentProps} />);
  expect(screen.getByText('stale')).toBeInTheDocument();
  expect(screen.queryByText('codes.connected')).not.toBeInTheDocument();
});

it('discards a slow response from an older configuration', async () => {
  let finish!: (value: unknown) => void;
  fetchMock.mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve;
      })
  );
  const currentProps = props();
  const { rerender } = render(<InstanceDiagnostics {...currentProps} />);
  fireEvent.click(screen.getByRole('button', { name: 'check' }));
  expect(screen.getAllByText('checking')).toHaveLength(2);
  rerender(
    <InstanceDiagnostics {...currentProps} providerId="another-provider" />
  );
  await act(async () => finish({ ok: true, json: async () => success }));
  expect(screen.getByText('stale')).toBeInTheDocument();
  expect(screen.queryByText('codes.connected')).not.toBeInTheDocument();
});

it('allows editing with a saved credential and does not transmit an empty key', async () => {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ ...success, resultsPaused: true }),
  });
  render(
    <InstanceDiagnostics
      {...props()}
      formData={createEmptyInstanceFormData()}
      serviceInstanceId="saved-instance"
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'check' }));
  await screen.findByText('resultsPaused');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    providerId: 'provider',
    serviceInstanceId: 'saved-instance',
    backend: 'dify',
  });
});

it.each([
  ['', '   ', undefined],
  ['synthetic-key', '  synthetic-key  ', 'synthetic-key'],
] as const)(
  'keeps equivalent edit credentials checked when %p becomes %p',
  async (initialKey, editedKey, expectedKey) => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => success });
    const currentProps = {
      ...props(),
      formData: { ...draft(), apiKey: initialKey },
      serviceInstanceId: 'saved-instance',
    };
    const { rerender } = render(<InstanceDiagnostics {...currentProps} />);
    fireEvent.click(screen.getByRole('button', { name: 'check' }));
    await screen.findByText('codes.connected');
    rerender(
      <InstanceDiagnostics
        {...currentProps}
        formData={{ ...currentProps.formData, apiKey: editedKey }}
      />
    );
    expect(screen.getByText('codes.connected')).toBeInTheDocument();
    expect(screen.queryByText('stale')).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'check' }));
    await screen.findByText('codes.connected');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const expectedInput = {
      providerId: 'provider',
      serviceInstanceId: 'saved-instance',
      backend: 'dify',
      ...(expectedKey ? { apiKey: expectedKey } : {}),
    };
    for (const [, request] of fetchMock.mock.calls) {
      expect(JSON.parse(request.body)).toEqual(expectedInput);
    }
  }
);

it('trims a new draft credential and disables whitespace-only credentials', async () => {
  fetchMock.mockResolvedValue({ ok: true, json: async () => success });
  const currentProps = props();
  const { rerender } = render(
    <InstanceDiagnostics
      {...currentProps}
      formData={{ ...currentProps.formData, apiKey: '  synthetic-key  ' }}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'check' }));
  await screen.findByText('codes.connected');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).apiKey).toBe(
    'synthetic-key'
  );
  rerender(
    <InstanceDiagnostics
      {...currentProps}
      formData={{ ...currentProps.formData, apiKey: '   ' }}
    />
  );
  expect(screen.getByRole('button', { name: 'check' })).toBeDisabled();
  expect(screen.getByText('stale')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it('shows unsupported and failed results rather than a green success', async () => {
  fetchMock
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: 'unsupported',
        code: 'unsupported',
        capabilities: [],
      }),
    })
    .mockRejectedValueOnce(new Error('private failure'));
  render(<InstanceDiagnostics {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: 'check' }));
  await screen.findByText('codes.unsupported');
  fireEvent.click(screen.getByRole('button', { name: 'check' }));
  await screen.findByText('codes.unavailable');
  expect(screen.queryByText('private failure')).not.toBeInTheDocument();
});

it('aborts a pending diagnostic on unmount', async () => {
  fetchMock.mockImplementation(() => new Promise(() => {}));
  const { unmount } = render(<InstanceDiagnostics {...props()} />);
  fireEvent.click(screen.getByRole('button', { name: 'check' }));
  const signal = fetchMock.mock.calls[0][1].signal;
  unmount();
  await waitFor(() => expect(signal.aborted).toBe(true));
});

it('normalizes the assistant ID like saving and distinguishes invalid configuration', async () => {
  fetchMock.mockResolvedValue({ ok: false, status: 400 });
  const formData = draft();
  formData.config.backend_type = 'langchain';
  formData.config.langchain = { assistant_id: '  agent  ' };
  render(<InstanceDiagnostics {...props()} formData={formData} />);
  fireEvent.click(screen.getByRole('button', { name: 'check' }));
  await screen.findByText('codes.invalidConfiguration');
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).assistantId).toBe('agent');
  expect(screen.queryByText('codes.unavailable')).not.toBeInTheDocument();
});

it('disables invalid drafts and respects external processing', () => {
  const { rerender } = render(
    <InstanceDiagnostics {...props()} providerId="" />
  );
  expect(screen.getByRole('button', { name: 'check' })).toBeDisabled();
  rerender(<InstanceDiagnostics {...props()} disabled />);
  expect(screen.getByRole('button', { name: 'check' })).toBeDisabled();
});
