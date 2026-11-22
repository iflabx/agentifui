import { uploadDifyFile } from '@lib/services/dify/file-service';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { act, fireEvent, render } from '@testing-library/react';

import type { AgentAttachmentSlot } from '../../../packages/shared/src/agent-input';
import { FileUploadField } from './file-upload-field';

const slot: AgentAttachmentSlot = {
  key: 'docs',
  label: 'Docs',
  target: 'inputs',
  minCount: 1,
  maxCount: 3,
  methods: ['local_file'],
  allowedTypes: ['document'],
  extensions: ['txt'],
  maxBytesByType: { document: 100 },
};

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
    jest.restoreAllMocks();
  });

  function setup() {
    const onChange = jest.fn();
    const view = render(
      <FileUploadField
        slot={slot}
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
            slot={slot}
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
            slot={slot}
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
        slot={slot}
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

  it('does not start a queued old-actor upload after logout and same-account login', async () => {
    mockAuth.loading = true;
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

  it('preserves files selected during same-actor authentication refresh and uploads once it finishes', async () => {
    const view = setup();
    const refresh = (loading: boolean) => {
      mockAuth.loading = loading;
      view.rerender(
        <FileUploadField
          slot={slot}
          config={{ max_length: 3 }}
          instanceId="app-B"
          value={null}
          onChange={view.onChange}
          isSingleFileMode
        />
      );
    };
    refresh(true);
    await act(async () => {
      view.select();
      jest.advanceTimersByTime(100);
    });
    expect(view.getByText('b.txt')).toBeInTheDocument();
    expect(uploadDifyFile).not.toHaveBeenCalled();
    await act(async () => {
      refresh(false);
      jest.advanceTimersByTime(100);
    });
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
    expect(view.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ upload_file_id: 'uploaded-B' })
    );
  });

  it('does not repeat an in-flight upload when authentication refresh completes', async () => {
    let finishUpload!: (value: never) => void;
    jest.mocked(uploadDifyFile).mockImplementation(
      () =>
        new Promise(resolve => {
          finishUpload = resolve;
        })
    );
    const view = setup();
    act(() => {
      view.select();
    });
    mockAuth.loading = true;
    const refresh = () =>
      view.rerender(
        <FileUploadField
          slot={slot}
          config={{ max_length: 3 }}
          instanceId="app-B"
          value={null}
          onChange={view.onChange}
          isSingleFileMode
        />
      );
    refresh();
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    mockAuth.loading = false;
    await act(async () => {
      refresh();
      jest.advanceTimersByTime(100);
    });
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
    expect(view.onChange).not.toHaveBeenCalled();
    await act(async () => {
      finishUpload({ id: 'uploaded-B' } as never);
    });
    expect(view.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ upload_file_id: 'uploaded-B' })
    );
  });

  it('queues a failed upload retry during authentication refresh and retries only once', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest
      .mocked(uploadDifyFile)
      .mockRejectedValueOnce(new Error('Upload failed'));
    const view = setup();
    await act(async () => {
      view.select();
    });
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
    const refresh = (loading: boolean) => {
      mockAuth.loading = loading;
      view.rerender(
        <FileUploadField
          slot={slot}
          config={{ max_length: 3 }}
          instanceId="app-B"
          value={null}
          onChange={view.onChange}
          isSingleFileMode
        />
      );
    };
    refresh(true);
    fireEvent.click(
      view.getByRole('button', {
        name: 'pages.workflow.fileUpload.retryUpload',
      })
    );
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
    await act(async () => {
      refresh(false);
    });
    expect(uploadDifyFile).toHaveBeenCalledTimes(2);
    expect(view.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ upload_file_id: 'uploaded-B' })
    );
  });

  it.each(['actor', 'app', 'remove', 'unmount'])(
    'discards a queued selection after %s before authentication refresh completes',
    async change => {
      mockAuth.loading = true;
      const view = setup();
      act(() => {
        view.select();
      });
      expect(view.getByText('b.txt')).toBeInTheDocument();
      if (change === 'actor')
        act(() => {
          useChatInputStore.getState().setActor(null);
          useChatInputStore.getState().setActor('actor');
        });
      if (change === 'remove') fireEvent.click(view.getByRole('button'));
      if (change === 'unmount') view.unmount();
      mockAuth.loading = false;
      if (change !== 'unmount')
        view.rerender(
          <FileUploadField
            slot={slot}
            config={{ max_length: 3 }}
            instanceId={change === 'app' ? 'app-C' : 'app-B'}
            value={null}
            onChange={view.onChange}
            isSingleFileMode
          />
        );
      await act(async () => {
        jest.advanceTimersByTime(100);
      });
      expect(uploadDifyFile).not.toHaveBeenCalled();
      expect(view.onChange).not.toHaveBeenCalled();
    }
  );
});
