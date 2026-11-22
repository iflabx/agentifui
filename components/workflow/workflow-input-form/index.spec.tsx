import { useChatInputStore } from '@lib/stores/chat-input-store';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { WorkflowInputForm } from '.';
import type { AgentInputCapabilities } from '../../../packages/shared/src/agent-input';

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
