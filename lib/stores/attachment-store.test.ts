import { useAttachmentStore } from './attachment-store';

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
