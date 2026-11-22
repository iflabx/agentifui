import type { AgentAttachmentSlot } from '../../packages/shared/src/agent-input';
import { useAttachmentStore } from './attachment-store';

const slot: AgentAttachmentSlot = {
  key: 'files',
  label: 'Files',
  target: 'files',
  minCount: 0,
  maxCount: 3,
  methods: ['local_file'],
  allowedTypes: ['document'],
  extensions: ['txt'],
  maxBytesByType: { document: 9 },
};

describe('scoped attachments and upload attempts', () => {
  const file = () =>
    new File(['synthetic'], 'same.txt', {
      type: 'text/plain',
      lastModified: 1,
    });
  beforeEach(() => {
    useAttachmentStore.getState().resetAll();
    useAttachmentStore.getState().setScope('A');
  });

  it('reserves batches atomically across concurrent selections and all statuses', async () => {
    const store = useAttachmentStore.getState();
    const select = () => store.reserveFiles([file(), file()], slot, 'A');
    const results = await Promise.all([
      Promise.resolve().then(select),
      Promise.resolve().then(select),
    ]);
    expect(results.map(result => result.error)).toEqual([
      null,
      'INPUT_TOO_MANY_FILES',
    ]);
    expect(store.getFiles('A')).toHaveLength(2);
    const [first, second] = store.getFiles('A');
    const attempt = store.beginUpload('A', first.id)!;
    store.finishUpload('A', first.id, attempt, { error: 'failed' });
    const secondAttempt = store.beginUpload('A', second.id)!;
    store.finishUpload('A', second.id, secondAttempt, { uploadedId: 'done' });
    expect(store.reserveFiles([file(), file()], slot, 'A').error).toBe(
      'INPUT_TOO_MANY_FILES'
    );
    store.beginUpload('A', first.id);
    expect(store.getFiles('A')).toHaveLength(2);
    expect(store.reserveFiles([file()], slot, 'A').error).toBeNull();
    expect(store.reserveFiles([file()], slot, 'A').error).toBe(
      'INPUT_TOO_MANY_FILES'
    );
    store.removeFile(second.id, 'A');
    expect(store.reserveFiles([file()], slot, 'A').error).toBeNull();
  });

  it('validates every selected file at the boundary and rejects a whole invalid batch', () => {
    const store = useAttachmentStore.getState();
    expect(store.reserveFiles([file()], slot, 'A').error).toBeNull();
    const old = store.getFiles('A');
    expect(
      store.reserveFiles([file(), new File(['bad'], 'bad.png')], slot, 'A')
        .error
    ).toBe('INPUT_FILE_TYPE');
    expect(store.getFiles('A')).toBe(old);
    expect(
      store.reserveFiles([new File(['0123456789'], 'large.txt')], slot, 'A')
        .error
    ).toBe('INPUT_FILE_SIZE');
    expect(
      store.reserveFiles([file()], { ...slot, maxCount: 0 }, 'B').error
    ).toBe('INPUT_TOO_MANY_FILES');
    expect(
      store.reserveFiles([file()], { ...slot, methods: ['remote_url'] }, 'B')
        .error
    ).toBe('INPUT_UPLOAD_DISABLED');
    expect(store.getFiles('B')).toEqual([]);
  });

  it('updates the original bucket when another application has the same file', () => {
    const store = useAttachmentStore.getState();
    store.addFiles([file()]);
    const original = store.getFiles('A')[0];
    const attempt = store.beginUpload('A', original.id)!;
    store.setScope('B');
    store.addFiles([file()]);
    store.finishUpload('A', original.id, attempt, { uploadedId: 'only-A' });
    expect(store.getFiles('B')[0].uploadedId).toBeUndefined();
    expect(store.getFiles('A')[0].uploadedId).toBe('only-A');
  });

  it('ignores an older retry, a removed file and an earlier actor result', () => {
    const store = useAttachmentStore.getState();
    store.addFiles([file()]);
    const id = store.getFiles('A')[0].id;
    const first = store.beginUpload('A', id)!;
    const second = store.beginUpload('A', id)!;
    store.finishUpload('A', id, second, { uploadedId: 'new' });
    store.finishUpload('A', id, first, { error: 'late error' });
    expect(store.getFiles('A')[0].uploadedId).toBe('new');
    store.removeFile(id);
    store.addFiles([file()]);
    store.finishUpload('A', id, second, { uploadedId: 'removed' });
    expect(store.getFiles('A')[0].uploadedId).toBeUndefined();
    store.resetAll();
    store.finishUpload('A', id, second, { uploadedId: 'previous actor' });
    expect(store.getFiles('A')).toEqual([]);
  });

  it('removes only sent attachments, preserving new files and retry attempts', () => {
    const store = useAttachmentStore.getState();
    store.addFiles([file()]);
    const snapshot = [...store.getFiles('A')];
    store.addFiles([file()]);
    store.consumeFiles('A', snapshot);
    expect(store.getFiles('A')).toHaveLength(1);
    const retrySnapshot = [...store.getFiles('A')];
    store.beginUpload('A', retrySnapshot[0].id);
    store.consumeFiles('A', retrySnapshot);
    expect(store.getFiles('A')).toHaveLength(1);
  });

  it('migrates same-application buckets with their in-flight upload callbacks', () => {
    const store = useAttachmentStore.getState();
    store.addFiles([file()]);
    const id = store.getFiles('A')[0].id;
    const attempt = store.beginUpload('A', id)!;
    store.setScope('conversation');
    expect(store.migrateScope('A', 'conversation')).toBe(true);
    store.finishUpload('A', id, attempt, { uploadedId: 'bound' });
    expect(useAttachmentStore.getState().files[0].uploadedId).toBe('bound');
  });
});
