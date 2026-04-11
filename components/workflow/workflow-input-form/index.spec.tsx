import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { WorkflowInputForm } from '.';

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

describe('WorkflowInputForm system-injected fields', () => {
  const originalFetch = global.fetch;
  const mockedFetch = jest.fn() as jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockedFetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('hides system-injected user fields and still allows execution', async () => {
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        app: {
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

    fireEvent.click(
      screen.getByRole('button', {
        name: 'startExecution',
      })
    );

    await waitFor(() => {
      expect(onExecute).toHaveBeenCalledWith({});
    });
  });
});
