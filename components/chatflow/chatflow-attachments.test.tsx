import { uploadDifyFile } from '@lib/services/dify/file-service';
import { useAttachmentStore } from '@lib/stores/attachment-store';
import { useChatInputStore } from '@lib/stores/chat-input-store';
import { act, fireEvent, render, screen } from '@testing-library/react';

import { type ReactNode, useLayoutEffect } from 'react';

import type { AgentAttachmentSlot } from '../../packages/shared/src/agent-input';
import { useChatflowAttachments } from './chatflow-attachments';

jest.mock('@lib/services/dify/file-service', () => ({
  uploadDifyFile: jest.fn(),
}));
jest.mock('next-intl', () => ({
  useTranslations: (namespace: string) => {
    const messages = jest.requireActual('../../messages/zh-CN.json');
    return (key: string, values?: Record<string, number>) => {
      if (
        namespace === 'pages.chat' &&
        [
          'fileTypeSelector.maxUpload',
          'fileTypeSelector.attachmentRequired',
          'fileTypeSelector.attachmentRemaining',
          'fileTypeSelector.attachmentRange',
          'fileTypeSelector.attachmentSelected',
        ].includes(key)
      ) {
        const template =
          messages.pages.chat.fileTypeSelector[key.split('.')[1]];
        return template.replace(/\{(\w+)\}/g, (_match: string, name: string) =>
          String(values?.[name])
        );
      }
      return `${namespace}.${key}`;
    };
  },
}));
jest.mock('@components/chat-input/button', () => ({
  ChatButton: ({
    ariaLabel,
    disabled,
    onClick,
    icon,
  }: {
    ariaLabel: string;
    disabled: boolean;
    onClick?: () => void;
    icon: ReactNode;
  }) => (
    <button
      type="button"
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
    </button>
  ),
}));
jest.mock('@components/ui/tooltip-wrapper', () => ({
  TooltipWrapper: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
jest.mock('@components/ui/popover', () => ({
  Popover: ({
    trigger,
    children,
    isOpen,
    onOpenChange,
  }: {
    trigger: ReactNode;
    children: ReactNode;
    isOpen: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <div>
      <div onClick={() => onOpenChange(!isOpen)}>{trigger}</div>
      {isOpen && children}
    </div>
  ),
}));

type Options = Parameters<typeof useChatflowAttachments>[0];
let snapshot: ReturnType<typeof useChatflowAttachments>;
const slot: AgentAttachmentSlot = {
  key: 'files',
  label: 'Message files',
  target: 'files',
  minCount: 0,
  maxCount: 3,
  methods: ['local_file'],
  allowedTypes: ['document'],
  extensions: ['txt'],
  maxBytesByType: { document: 1024 },
};
const defaults: Options = {
  scope: 'draft-A',
  instanceId: 'app-A',
  userId: 'actor-A',
  slots: [slot],
};
function Harness(props: Partial<Options>) {
  const attachments = useChatflowAttachments({ ...defaults, ...props });
  useLayoutEffect(() => {
    snapshot = attachments;
  }, [attachments]);
  return (
    <>
      {attachments.action}
      {attachments.preview}
    </>
  );
}
function file(name = 'reference.txt', content = 'synthetic') {
  return new File([content], name, { type: 'text/plain' });
}
function select(label: string, files: File[]) {
  fireEvent.change(screen.getByLabelText(label, { selector: 'input' }), {
    target: { files },
  });
}
function allDraftFiles() {
  return Object.values(useAttachmentStore.getState().filesByScope).flat();
}
function deferredUpload() {
  let resolve!: (response: { id: string; preview_url?: string }) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<{ id: string; preview_url?: string }>(
    (yes, no) => {
      resolve = yes;
      reject = no;
    }
  );
  jest.mocked(uploadDifyFile).mockReturnValueOnce(promise as never);
  return { resolve, reject };
}

describe('Chatflow composer attachments', () => {
  beforeEach(() => {
    jest.resetAllMocks();
    useChatInputStore.getState().setActor('actor-A');
    useAttachmentStore.getState().resetAll();
    jest.mocked(uploadDifyFile).mockImplementation(
      async (_app, upload) =>
        ({
          id: `${upload.name}-id`,
          preview_url: `/preview/${upload.name}`,
        }) as never
    );
  });

  it('keeps a disabled attachment icon without slots or local upload support', () => {
    const { rerender } = render(<Harness slots={[]} />);
    const button = screen.getByRole('button', {
      name: 'pages.chat.fileTypeSelector.ariaLabel',
    });
    expect(button).toBeDisabled();
    expect(button.parentElement).toHaveAttribute(
      'title',
      'pages.chat.fileTypeSelector.notSupported'
    );
    expect(snapshot.preview).toBeNull();
    expect(snapshot.blocked).toBe(false);
    rerender(<Harness slots={[{ ...slot, methods: ['remote_url'] }]} />);
    expect(button).toBeDisabled();
    expect(button.parentElement).toHaveAttribute(
      'title',
      'pages.chat.input.localUploadUnavailable'
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(snapshot.blocked).toBe(false);
    rerender(
      <Harness slots={[{ ...slot, methods: ['remote_url'], minCount: 1 }]} />
    );
    expect(snapshot.blocked).toBe(true);
    expect(snapshot.errors).toEqual([
      expect.stringContaining('pages.chat.input.filesRequired'),
    ]);
  });

  it('opens the only local picker directly and carries type, preview and owner metadata', async () => {
    render(<Harness />);
    const picker = screen.getByLabelText(slot.label) as HTMLInputElement;
    const click = jest.spyOn(picker, 'click').mockImplementation(() => {});
    fireEvent.click(
      screen.getByRole('button', {
        name: 'pages.chat.fileTypeSelector.ariaLabel',
      })
    );
    expect(click).toHaveBeenCalledTimes(1);
    expect(picker).toHaveAttribute('accept', '.txt');
    expect(picker.multiple).toBe(true);
    await act(async () => select(slot.label, [file()]));
    expect(snapshot.blocked).toBe(false);
    expect(snapshot.inputs).toEqual({});
    expect(snapshot.files).toEqual([
      {
        type: 'document',
        transfer_method: 'local_file',
        upload_file_id: 'reference.txt-id',
        name: 'reference.txt',
        size: 9,
        mime_type: 'text/plain',
        preview_url: '/preview/reference.txt',
        app_id: 'app-A',
        actor_id: 'actor-A',
        actor_epoch: useChatInputStore.getState().actorEpoch,
      },
    ]);
    expect(screen.getByRole('status')).toHaveTextContent(
      '已添加 1 个附件 · 最多 3 个'
    );
    expect(screen.queryByText('Message files 1/3')).not.toBeInTheDocument();
    click.mockRestore();
  });

  it('keeps a selection pending during authentication refresh and starts it once afterward', async () => {
    const { rerender } = render(<Harness authLoading />);
    const picker = screen.getByLabelText(slot.label, { selector: 'input' });
    select(slot.label, [file()]);
    expect(screen.getByText('reference.txt')).toBeInTheDocument();
    expect(allDraftFiles()[0].status).toBe('pending');
    expect(snapshot.blocked).toBe(true);
    expect(uploadDifyFile).not.toHaveBeenCalled();
    await act(async () => rerender(<Harness />));
    expect(screen.getByLabelText(slot.label, { selector: 'input' })).toBe(
      picker
    );
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
    expect(snapshot.files[0].upload_file_id).toBe('reference.txt-id');
    await act(async () => rerender(<Harness authLoading />));
    await act(async () => rerender(<Harness />));
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
  });

  it('does not duplicate an in-flight upload after authentication refresh', async () => {
    const pending = deferredUpload();
    const { rerender } = render(<Harness />);
    select(slot.label, [file()]);
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
    rerender(<Harness authLoading />);
    rerender(<Harness />);
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ id: 'one-upload' }));
    expect(snapshot.files[0].upload_file_id).toBe('one-upload');
  });

  it('queues an explicit failed-upload retry until authentication refresh completes', async () => {
    const pending = deferredUpload();
    const { rerender } = render(<Harness />);
    select(slot.label, [file()]);
    await act(async () => pending.reject(new Error('synthetic failure')));
    rerender(<Harness authLoading />);
    fireEvent.click(screen.getByRole('button', { name: 'common.ui.retry' }));
    expect(allDraftFiles()[0].status).toBe('pending');
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
    await act(async () => rerender(<Harness />));
    expect(uploadDifyFile).toHaveBeenCalledTimes(2);
    expect(snapshot.files[0].upload_file_id).toBe('reference.txt-id');
  });

  it('does not resume a queued selection into another actor or draft', async () => {
    const { rerender } = render(<Harness authLoading />);
    select(slot.label, [file()]);
    await act(async () => rerender(<Harness scope="draft-B" />));
    expect(uploadDifyFile).not.toHaveBeenCalled();
    expect(snapshot.files).toEqual([]);
    act(() => {
      useChatInputStore.getState().setActor('actor-B');
      useAttachmentStore.getState().resetAll();
    });
    await act(async () => rerender(<Harness userId="actor-B" />));
    expect(uploadDifyFile).not.toHaveBeenCalled();
    expect(allDraftFiles()).toEqual([]);
  });

  it('requires explicit multi-slot selection and maps original input keys without duplicating files', async () => {
    const single = {
      ...slot,
      target: 'inputs' as const,
      key: 'original_key',
      label: 'Primary source',
      multiple: false,
      minCount: 1,
    };
    const multiple = {
      ...slot,
      target: 'inputs' as const,
      key: 'supporting_docs',
      label: 'Supporting sources',
      multiple: true,
    };
    render(<Harness slots={[single, multiple, { ...slot, maxCount: 1 }]} />);
    const primaryPicker = screen.getByLabelText(
      single.label
    ) as HTMLInputElement;
    const messagePicker = screen.getByLabelText(slot.label) as HTMLInputElement;
    const primaryClick = jest
      .spyOn(primaryPicker, 'click')
      .mockImplementation(() => {});
    const messageClick = jest
      .spyOn(messagePicker, 'click')
      .mockImplementation(() => {});
    fireEvent.click(
      screen.getByRole('button', {
        name: 'pages.chat.fileTypeSelector.ariaLabel',
      })
    );
    expect(primaryClick).not.toHaveBeenCalled();
    expect(messageClick).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Primary source 请添加 1 个附件' })
    );
    expect(primaryClick).toHaveBeenCalledTimes(1);
    expect(messageClick).not.toHaveBeenCalled();
    expect(primaryPicker.multiple).toBe(false);
    await act(async () => select(single.label, [file('primary.txt')]));
    await act(async () =>
      select(multiple.label, [file('one.txt'), file('two.txt')])
    );
    await act(async () => select(slot.label, [file('message.txt')]));
    expect(snapshot.blocked).toBe(false);
    expect(snapshot.inputs.original_key).toMatchObject({
      upload_file_id: 'primary.txt-id',
    });
    expect(snapshot.inputs.supporting_docs).toEqual([
      expect.objectContaining({ upload_file_id: 'one.txt-id' }),
      expect.objectContaining({ upload_file_id: 'two.txt-id' }),
    ]);
    expect(snapshot.files.map(entry => entry.upload_file_id)).toEqual([
      'message.txt-id',
    ]);
    expect(allDraftFiles()).toHaveLength(4);
    fireEvent.click(
      screen.getByRole('button', {
        name: 'pages.chat.fileTypeSelector.ariaLabel',
      })
    );
    expect(
      screen.getByRole('button', { name: /Primary source 已添加 1 个附件/ })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Message files 已添加 1 个附件/ })
    ).toBeDisabled();
    expect(
      screen.getByRole('button', {
        name: 'Supporting sources 已添加 2 个附件 · 最多 3 个',
      })
    ).not.toBeDisabled();
    primaryClick.mockRestore();
    messageClick.mockRestore();
  });

  it('shows a readable optional limit and restores the icon after removing a full selection', async () => {
    render(<Harness slots={[{ ...slot, maxCount: 1 }]} />);
    const button = screen.getByRole('button', {
      name: 'pages.chat.fileTypeSelector.ariaLabel',
    });
    expect(button).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('最多上传 1 个文件');
    await act(async () => select(slot.label, [file()]));
    expect(button).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(
      '已添加 1 个附件 · 最多 1 个'
    );
    fireEvent.click(screen.getByRole('button', { name: 'common.ui.remove' }));
    expect(button).toBeEnabled();
    expect(screen.getByRole('status')).toHaveTextContent('最多上传 1 个文件');
  });

  it.each([
    [1, 1, '请添加 1 个附件'],
    [2, 4, '请添加 2–4 个附件'],
  ])(
    'describes required limits %i–%i without a duplicate error',
    (minCount, maxCount, hint) => {
      render(<Harness slots={[{ ...slot, minCount, maxCount }]} />);
      expect(screen.getByRole('status')).toHaveTextContent(hint);
      expect(snapshot.blocked).toBe(true);
      expect(snapshot.errors).toEqual([]);
    }
  );

  it('keeps missing required counts visible even when another purpose has enough files', async () => {
    const required = {
      ...slot,
      key: 'required',
      label: 'Required sources',
      minCount: 2,
      maxCount: 2,
      target: 'inputs' as const,
      multiple: true,
    };
    render(<Harness slots={[required, slot]} />);
    await act(async () =>
      select(slot.label, [file('one.txt'), file('two.txt')])
    );
    expect(screen.getByRole('status')).toHaveTextContent('还需添加 2 个附件');
    expect(snapshot.blocked).toBe(true);
    await act(async () => select(required.label, [file('required-one.txt')]));
    expect(screen.getByRole('status')).toHaveTextContent('还需添加 1 个附件');
    expect(snapshot.blocked).toBe(true);
    await act(async () => select(required.label, [file('required-two.txt')]));
    expect(screen.getByRole('status')).not.toHaveTextContent('还需添加');
    expect(snapshot.blocked).toBe(false);
  });

  it('disables a full multi-slot picker rather than opening an unusable menu', async () => {
    const second = {
      ...slot,
      key: 'source',
      label: 'Source',
      target: 'inputs' as const,
    };
    render(
      <Harness
        slots={[
          { ...slot, maxCount: 1 },
          { ...second, maxCount: 1 },
        ]}
      />
    );
    await act(async () => select(slot.label, [file('one.txt')]));
    await act(async () => select(second.label, [file('two.txt')]));
    const button = screen.getByRole('button', {
      name: 'pages.chat.fileTypeSelector.ariaLabel',
    });
    expect(button).toBeDisabled();
    fireEvent.click(button.parentElement!);
    expect(
      screen.queryByRole('button', { name: /Source 已添加/ })
    ).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '已添加 2 个附件 · 最多 2 个'
    );
  });

  it.each(['success', 'failure'])(
    'blocks immediately while uploading and ignores a late %s after removal',
    async outcome => {
      const pending = deferredUpload();
      render(<Harness />);
      select(slot.label, [file()]);
      expect(snapshot.blocked).toBe(true);
      expect(snapshot.files).toEqual([]);
      expect(allDraftFiles()[0].status).toBe('uploading');
      fireEvent.click(
        screen.getByRole('button', {
          name: 'common.ui.remove',
        })
      );
      expect(snapshot.blocked).toBe(false);
      await act(async () => {
        if (outcome === 'success') pending.resolve({ id: 'late' });
        else pending.reject(new Error('removed upload'));
      });
      expect(allDraftFiles()).toEqual([]);
      expect(snapshot.files).toEqual([]);
    }
  );

  it('retains failed attachments for retry in place, without reserving another slot', async () => {
    const pending = deferredUpload();
    const onRequirementsChanged = jest.fn();
    render(
      <Harness
        onRequirementsChanged={onRequirementsChanged}
        slots={[{ ...slot, maxCount: 1 }]}
      />
    );
    select(slot.label, [file()]);
    const id = allDraftFiles()[0].id;
    await act(async () => pending.reject(new Error('temporary failure')));
    expect(snapshot.blocked).toBe(true);
    expect(allDraftFiles()[0]).toMatchObject({
      id,
      status: 'error',
      error: 'temporary failure',
    });
    expect(onRequirementsChanged).toHaveBeenCalledTimes(1);
    await act(async () =>
      fireEvent.click(
        screen.getByRole('button', {
          name: 'common.ui.retry',
        })
      )
    );
    expect(snapshot.blocked).toBe(false);
    expect(allDraftFiles()).toHaveLength(1);
    expect(allDraftFiles()[0]).toMatchObject({
      id,
      status: 'success',
      uploadAttempt: 2,
    });
    expect(uploadDifyFile).toHaveBeenCalledTimes(2);
  });

  it('rejects an entire overflow or invalid batch while preserving existing files', async () => {
    render(<Harness slots={[{ ...slot, maxCount: 2 }]} />);
    await act(async () => select(slot.label, [file('existing.txt')]));
    await act(async () =>
      select(slot.label, [file('overflow-1.txt'), file('overflow-2.txt')])
    );
    expect(allDraftFiles()).toHaveLength(1);
    expect(snapshot.files[0].name).toBe('existing.txt');
    expect(snapshot.errors).toEqual([
      expect.stringContaining('pages.chat.fileTypeSelector.maxFilesReached'),
    ]);
    await act(async () => select(slot.label, [file('wrong.png')]));
    expect(snapshot.errors).toEqual([
      expect.stringContaining('pages.chat.fileUpload.unsupportedFormat'),
    ]);
    await act(async () =>
      select(slot.label, [file('large.txt', 'x'.repeat(1025))])
    );
    expect(snapshot.errors).toEqual([
      expect.stringContaining('pages.chat.fileUpload.fileTooLarge'),
    ]);
    expect(uploadDifyFile).toHaveBeenCalledTimes(1);
    expect(allDraftFiles()).toHaveLength(1);
  });

  it('revalidates counts and file types when slot capabilities change', async () => {
    const { rerender } = render(<Harness />);
    await act(async () =>
      select(slot.label, [file('one.txt'), file('two.txt')])
    );
    rerender(<Harness slots={[{ ...slot, maxCount: 1 }]} />);
    expect(snapshot.blocked).toBe(true);
    expect(snapshot.errors).toEqual([
      expect.stringContaining('pages.chat.fileTypeSelector.maxFilesReached'),
    ]);
    rerender(<Harness slots={[{ ...slot, extensions: ['pdf'] }]} />);
    expect(snapshot.blocked).toBe(true);
    expect(snapshot.errors).toEqual([
      expect.stringContaining('pages.chat.fileUpload.unsupportedFormat'),
    ]);
    expect(allDraftFiles()).toHaveLength(2);
  });

  it('consumes only its captured files and leaves newer selections and other drafts alone', async () => {
    const { rerender } = render(<Harness />);
    await act(async () => select(slot.label, [file('submitted.txt')]));
    const consume = snapshot.consume;
    await act(async () => select(slot.label, [file('new.txt')]));
    rerender(<Harness scope="draft-B" />);
    await act(async () => select(slot.label, [file('other-draft.txt')]));
    act(() => consume());
    expect(snapshot.files[0].name).toBe('other-draft.txt');
    rerender(<Harness />);
    expect(snapshot.files.map(entry => entry.name)).toEqual(['new.txt']);
  });

  it('keeps the same slot drafts across base-scope migration, including in-flight uploads', async () => {
    const pending = deferredUpload();
    const { rerender } = render(<Harness />);
    select(slot.label, [file()]);
    act(() => {
      useAttachmentStore.getState().migrateScope('draft-A', 'conversation-A');
    });
    rerender(<Harness scope="conversation-A" />);
    expect(allDraftFiles()).toHaveLength(1);
    expect(snapshot.blocked).toBe(true);
    await act(async () => pending.resolve({ id: 'migrated' }));
    expect(snapshot.files[0].upload_file_id).toBe('migrated');
    act(() => snapshot.consume());
    expect(snapshot.files).toEqual([]);
  });

  it('consumes a frozen multi-slot submission after root alias adoption without clearing the next draft', async () => {
    const source: AgentAttachmentSlot = {
      ...slot,
      key: 'source',
      multiple: false,
      label: 'Initialization source',
      target: 'inputs',
    };
    const slots = [source, slot];
    const { rerender } = render(<Harness slots={slots} />);
    await act(async () => select(source.label, [file('initial.txt')]));
    await act(async () => select(slot.label, [file('submitted.txt')]));
    const consumeAccepted = snapshot.consume;
    const buckets = Object.keys(useAttachmentStore.getState().filesByScope);
    act(() => {
      useAttachmentStore.getState().migrateScope('draft-A', 'conversation-A');
    });
    rerender(<Harness slots={slots} scope="conversation-A" disabled />);
    expect(snapshot.blocked).toBe(false);
    expect(snapshot.inputs.source).toMatchObject({ name: 'initial.txt' });
    expect(snapshot.files[0].name).toBe('submitted.txt');
    expect(Object.keys(useAttachmentStore.getState().filesByScope)).toEqual(
      expect.arrayContaining(buckets)
    );
    expect(useAttachmentStore.getState().resolveScope('draft-A')).toBe(
      'conversation-A'
    );
    rerender(<Harness slots={slots} scope="conversation-A" />);
    await act(async () => select(slot.label, [file('next-draft.txt')]));
    act(() => consumeAccepted());
    expect(snapshot.inputs).toEqual({});
    expect(snapshot.files.map(entry => entry.name)).toEqual(['next-draft.txt']);
    rerender(<Harness slots={slots} />);
    expect(snapshot.files.map(entry => entry.name)).toEqual(['next-draft.txt']);
    expect(allDraftFiles().map(entry => entry.name)).toEqual([
      'next-draft.txt',
    ]);
  });

  it.each(['actor-B', 'actor-A'])(
    'ignores old uploads and consumption after relogin as %s',
    async actor => {
      const pending = deferredUpload();
      const { rerender } = render(<Harness />);
      select(slot.label, [file('old.txt')]);
      const consume = snapshot.consume;
      act(() => {
        useChatInputStore.getState().setActor(null);
        useChatInputStore.getState().setActor(actor);
      });
      rerender(<Harness userId={actor} />);
      await act(async () => select(slot.label, [file('new-owner.txt')]));
      await act(async () => pending.resolve({ id: 'old-owner' }));
      act(() => consume());
      expect(snapshot.files.map(entry => entry.upload_file_id)).toEqual([
        'new-owner.txt-id',
      ]);
      expect(
        allDraftFiles().find(entry => entry.name === 'old.txt')?.uploadedId
      ).toBeUndefined();
    }
  );

  it('isolates applications and rejects successful references with mismatched upload ownership', async () => {
    const { rerender } = render(<Harness />);
    await act(async () => select(slot.label, [file()]));
    rerender(<Harness instanceId="app-B" />);
    expect(snapshot.files).toEqual([]);
    rerender(<Harness />);
    expect(snapshot.files).toHaveLength(1);
    act(() => {
      const store = useAttachmentStore.getState();
      const bucket = Object.keys(store.filesByScope)[0];
      store.setFiles(
        store
          .getFiles(bucket)
          .map(entry => ({ ...entry, uploadedActorId: 'other' })),
        bucket
      );
    });
    expect(snapshot.blocked).toBe(true);
    expect(snapshot.files).toEqual([]);
  });

  it('does not select files while disabled or without a current authenticated owner', () => {
    const { rerender } = render(<Harness disabled />);
    select(slot.label, [file()]);
    rerender(<Harness userId={undefined} />);
    select(slot.label, [file()]);
    rerender(<Harness scope={null} />);
    select(slot.label, [file()]);
    expect(uploadDifyFile).not.toHaveBeenCalled();
    expect(allDraftFiles()).toEqual([]);
  });
});
