import { createUploadFiles, getSuccessfulFilesPayload } from './helpers';

describe('workflow upload provenance', () => {
  const owner = { app_id: 'app-B', actor_id: 'actor', actor_epoch: 7 };
  const upload = {
    ...createUploadFiles([
      new File(['hello'], 'hello.txt', { type: 'text/plain' }),
    ])[0],
    ...owner,
    status: 'success' as const,
    uploadedId: 'uploaded-B',
  };

  it('preserves the upload app and actor in single and list payloads', () => {
    for (const single of [true, false]) {
      const payload = getSuccessfulFilesPayload([upload], single, owner);
      expect(single ? payload.value : (payload.value as unknown[])[0]).toEqual(
        expect.objectContaining({ ...owner, upload_file_id: 'uploaded-B' })
      );
    }
  });

  it.each([
    { app_id: 'app-A' },
    { actor_id: 'other' },
    { actor_epoch: 6 },
    { app_id: undefined, actor_id: undefined, actor_epoch: undefined },
  ])('does not relabel foreign or unowned successful uploads: %s', foreign => {
    expect(
      getSuccessfulFilesPayload([{ ...upload, ...foreign }], false, owner).value
    ).toEqual([]);
  });

  it('gives reselected identical files independent upload identities', () => {
    const file = new File(['same'], 'same.txt');
    expect(createUploadFiles([file])[0].id).not.toBe(
      createUploadFiles([file])[0].id
    );
  });
});
