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

  function setup(compact = false) {
    const onChange = jest.fn();
    const view = render(
      <FileUploadField
        compact={compact}
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

  function savedFile(id: string) {
    return {
      upload_file_id: id,
      name: `${id}.txt`,
      size: 1,
      type: 'document',
      mime_type: 'text/plain',
      transfer_method: 'local_file',
      app_id: 'app-B',
      actor_id: 'actor',
      actor_epoch: useChatInputStore.getState().actorEpoch,
      preview_file_id: `preview-${id}`,
    };
  }

  it.each([true, false])(
    'hydrates saved references and removes the currently displayed file (single=%s)',
    async single => {
      const first = savedFile('A');
      const second = savedFile('B');
      const onChange = jest.fn();
      const props = {
        slot,
        config: {},
        instanceId: 'app-B',
        onChange,
        isSingleFileMode: single,
      };
      const view = render(
        <FileUploadField {...props} value={single ? second : [second]} />
      );
      expect(view.getByText('B.txt')).toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      view.rerender(
        <FileUploadField {...props} value={single ? first : [first, second]} />
      );
      expect(view.getByText('A.txt')).toBeInTheDocument();
      if (single) expect(view.queryByText('B.txt')).not.toBeInTheDocument();
      fireEvent.click(
        view.getByText('A.txt').closest('.group')!.querySelector('button')!
      );
      expect(onChange).toHaveBeenLastCalledWith(single ? null : [second]);
      expect(view.queryByText('A.txt')).not.toBeInTheDocument();
      expect(uploadDifyFile).not.toHaveBeenCalled();
    }
  );

  it('uses shared compact cards, retries failures and prevents changes during execution', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest
      .mocked(uploadDifyFile)
      .mockRejectedValueOnce(new Error('Upload failed'));
    const view = setup(true);
    await act(async () => {
      view.select();
    });
    expect(view.getByText('b.txt')).toBeInTheDocument();
    expect(
      view.getByRole('button', { name: 'common.ui.retry' })
    ).not.toBeDisabled();
    expect(view.getByRole('alert')).toHaveTextContent('Upload failed');
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'common.ui.retry' }));
    });
    expect(uploadDifyFile).toHaveBeenCalledTimes(2);
    expect(view.onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ upload_file_id: 'uploaded-B' })
    );
    view.rerender(
      <FileUploadField
        compact
        disabled
        slot={slot}
        config={{}}
        instanceId="app-B"
        value={view.onChange.mock.calls.at(-1)![0]}
        onChange={view.onChange}
        isSingleFileMode
      />
    );
    expect(
      view.getByRole('button', { name: 'common.ui.remove' })
    ).toBeDisabled();
    expect(view.container.querySelector('input[type=file]')).toBeDisabled();
  });

  it('discards a late compact upload after the pending card is removed', async () => {
    let finish!: (result: never) => void;
    jest.mocked(uploadDifyFile).mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const view = setup(true);
    act(() => {
      view.select();
    });
    expect(view.getByText('b.txt')).toBeInTheDocument();
    fireEvent.click(view.getByRole('button', { name: 'common.ui.remove' }));
    await act(async () => {
      finish({ id: 'late' } as never);
    });
    expect(view.queryByText('b.txt')).not.toBeInTheDocument();
    expect(view.onChange).not.toHaveBeenCalled();
  });

  it('replaces a fresh uploaded B with controlled A without reuploading or reemitting B', async () => {
    const view = setup();
    await act(async () => {
      view.select();
    });
    expect(view.getByText('b.txt')).toBeInTheDocument();
    view.onChange.mockClear();
    view.rerender(
      <FileUploadField
        slot={slot}
        config={{}}
        instanceId="app-B"
        value={savedFile('A')}
        onChange={view.onChange}
        isSingleFileMode
      />
    );
    expect(view.getByText('A.txt')).toBeInTheDocument();
    expect(view.queryByText('b.txt')).not.toBeInTheDocument();
    expect(view.onChange).not.toHaveBeenCalled();
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
    fireEvent.click(view.getByRole('button'));
    expect(view.onChange).toHaveBeenLastCalledWith(null);
  });

  it('ignores a pending upload completion after restoring another reference', async () => {
    let finish!: (value: never) => void;
    jest.mocked(uploadDifyFile).mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const view = setup();
    act(() => {
      view.select();
    });
    view.rerender(
      <FileUploadField
        slot={slot}
        config={{}}
        instanceId="app-B"
        value={savedFile('A')}
        onChange={view.onChange}
        isSingleFileMode
      />
    );
    await act(async () => {
      finish({ id: 'late-B' } as never);
    });
    expect(view.getByText('A.txt')).toBeInTheDocument();
    expect(view.queryByText('b.txt')).not.toBeInTheDocument();
    expect(view.onChange).not.toHaveBeenCalled();
  });

  it('preserves an in-flight selection when its successful controlled references are echoed', async () => {
    let finish!: (value: never) => void;
    jest.mocked(uploadDifyFile).mockImplementation(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    const onChange = jest.fn();
    const first = savedFile('A');
    const props = { slot, config: {}, instanceId: 'app-B', onChange };
    const view = render(<FileUploadField {...props} value={[first]} />);
    act(() => {
      fireEvent.change(view.container.querySelector('input[type="file"]')!, {
        target: { files: [new File(['B'], 'b.txt', { type: 'text/plain' })] },
      });
    });
    view.rerender(<FileUploadField {...props} value={[{ ...first }]} />);
    expect(view.getByText('b.txt')).toBeInTheDocument();
    await act(async () => {
      finish({ id: 'fresh-B' } as never);
    });
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith([
      first,
      expect.objectContaining({ upload_file_id: 'fresh-B' }),
    ]);
  });

  it.each(['app', 'actor', 'epoch'])(
    'rejects saved references with a foreign %s',
    scope => {
      const reference = savedFile('foreign');
      if (scope === 'app') reference.app_id = 'other';
      if (scope === 'actor') reference.actor_id = 'other';
      if (scope === 'epoch') reference.actor_epoch -= 1;
      const onChange = jest.fn();
      const view = render(
        <FileUploadField
          slot={slot}
          config={{}}
          instanceId="app-B"
          value={reference}
          onChange={onChange}
        />
      );
      expect(view.queryByText('foreign.txt')).not.toBeInTheDocument();
      expect(onChange).not.toHaveBeenCalled();
      expect(uploadDifyFile).not.toHaveBeenCalled();
    }
  );

  it('allows an explicitly current-scoped historical restore from an older epoch, but not another actor or app', () => {
    const scope = {
      app_id: 'app-B',
      actor_id: 'actor',
      actor_epoch: useChatInputStore.getState().actorEpoch,
    };
    const old = { ...savedFile('history'), actor_epoch: scope.actor_epoch - 1 };
    const onChange = jest.fn();
    const props = {
      slot,
      config: {},
      instanceId: 'app-B',
      onChange,
      restoreScope: scope,
      isSingleFileMode: true,
    };
    const view = render(<FileUploadField {...props} value={old} />);
    expect(view.getByText('history.txt')).toBeInTheDocument();
    fireEvent.click(view.getByRole('button'));
    expect(onChange).toHaveBeenLastCalledWith(null);
    view.rerender(
      <FileUploadField {...props} value={{ ...old, actor_id: 'other' }} />
    );
    expect(view.queryByText('history.txt')).not.toBeInTheDocument();
    view.rerender(
      <FileUploadField {...props} value={{ ...old, app_id: 'other' }} />
    );
    expect(view.queryByText('history.txt')).not.toBeInTheDocument();
    view.rerender(
      <FileUploadField
        {...props}
        restoreScope={{ ...scope, actor_epoch: scope.actor_epoch - 1 }}
        value={old}
      />
    );
    expect(view.queryByText('history.txt')).not.toBeInTheDocument();
    expect(uploadDifyFile).not.toHaveBeenCalled();
  });

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

  it.each([false, true])(
    'preserves files selected during same-actor authentication refresh and uploads once it finishes (compact=%s)',
    async compact => {
      const view = setup(compact);
      const input = view.container.querySelector('input[type="file"]');
      const refresh = (loading: boolean) => {
        mockAuth.loading = loading;
        view.rerender(
          <FileUploadField
            compact={compact}
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
      expect(view.container.querySelector('input[type="file"]')).toBe(input);
      expect(input).not.toBeDisabled();
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
    }
  );

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
