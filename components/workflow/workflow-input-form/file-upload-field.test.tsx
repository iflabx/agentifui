import { uploadDifyFile } from '@lib/services/dify/file-service';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { act, fireEvent, render } from '@testing-library/react';

import { FileUploadField } from './file-upload-field';

const mockAuth = { session: { user: { id: 'actor' } }, loading: false };
jest.mock('@lib/auth/better-auth/react-hooks', () => ({
  useAuthSession: () => mockAuth,
}));
jest.mock('@lib/hooks/use-current-app', () => ({
  useCurrentApp: () => ({ currentAppId: 'unrelated-selected-app' }),
}));
jest.mock('@lib/services/dify/file-service', () => ({
  uploadDifyFile: jest.fn(),
}));

describe('form upload ownership', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    mockAuth.loading = false;
    useChatInputStore.getState().setActor(null);
    useChatInputStore.getState().setActor('actor');
    jest
      .mocked(uploadDifyFile)
      .mockResolvedValue({ id: 'uploaded-B' } as never);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  function setup() {
    const onChange = jest.fn();
    const view = render(
      <FileUploadField
        config={{ max_length: 3 }}
        instanceId="app-B"
        value={null}
        onChange={onChange}
        isSingleFileMode
      />
    );
    const select = () =>
      fireEvent.change(view.container.querySelector('input[type="file"]')!, {
        target: { files: [new File(['B'], 'b.txt', { type: 'text/plain' })] },
      });
    return { ...view, onChange, select };
  }

  it('uploads to the rendered instance, not an unrelated selected app, and includes actor provenance', async () => {
    const view = setup();
    const actorEpoch = useChatInputStore.getState().actorEpoch;
    await act(async () => {
      view.select();
      jest.advanceTimersByTime(100);
    });
    expect(uploadDifyFile).toHaveBeenCalledWith(
      'app-B',
      expect.any(File),
      'actor'
    );
    expect(view.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        app_id: 'app-B',
        actor_id: 'actor',
        actor_epoch: actorEpoch,
        upload_file_id: 'uploaded-B',
      })
    );
  });

  it.each(['actor', 'app', 'app-round-trip', 'unmount'])(
    'does not restore a delayed upload after changing %s',
    async change => {
      let finish!: (value: never) => void;
      jest.mocked(uploadDifyFile).mockImplementation(
        () =>
          new Promise(resolve => {
            finish = resolve;
          })
      );
      const view = setup();
      await act(async () => {
        view.select();
        jest.advanceTimersByTime(100);
      });
      if (change === 'actor')
        act(() => {
          useChatInputStore.getState().setActor(null);
          useChatInputStore.getState().setActor('actor');
        });
      if (change === 'app' || change === 'app-round-trip')
        view.rerender(
          <FileUploadField
            config={{ max_length: 3 }}
            instanceId="app-C"
            value={null}
            onChange={view.onChange}
            isSingleFileMode
          />
        );
      if (change === 'app-round-trip')
        view.rerender(
          <FileUploadField
            config={{ max_length: 3 }}
            instanceId="app-B"
            value={null}
            onChange={view.onChange}
            isSingleFileMode
          />
        );
      if (change === 'unmount') view.unmount();
      view.onChange.mockClear();
      await act(async () => {
        finish({ id: 'old-upload' } as never);
      });
      expect(view.onChange).not.toHaveBeenCalled();
    }
  );

  it('does not redisplay successful old-actor files or reemit their payload after same-account login', async () => {
    const view = setup();
    await act(async () => {
      view.select();
      jest.advanceTimersByTime(100);
    });
    expect(view.getByText('b.txt')).toBeInTheDocument();
    const oldPayload = view.onChange.mock.calls.at(-1)?.[0];
    view.onChange.mockClear();
    act(() => {
      useChatInputStore.getState().setActor(null);
      useChatInputStore.getState().setActor('actor');
    });
    view.rerender(
      <FileUploadField
        config={{ max_length: 3 }}
        instanceId="app-B"
        value={oldPayload}
        onChange={view.onChange}
        isSingleFileMode
      />
    );
    expect(view.queryByText('b.txt')).not.toBeInTheDocument();
    expect(view.onChange).not.toHaveBeenCalled();
  });

  it('does not start a scheduled old-actor upload after logout and same-account login', async () => {
    const view = setup();
    act(() => {
      view.select();
      useChatInputStore.getState().setActor(null);
      useChatInputStore.getState().setActor('actor');
    });
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(uploadDifyFile).not.toHaveBeenCalled();
  });

  it('does not upload while authentication is loading', async () => {
    mockAuth.loading = true;
    const view = setup();
    await act(async () => {
      view.select();
      jest.advanceTimersByTime(100);
    });
    expect(uploadDifyFile).not.toHaveBeenCalled();
  });
});
