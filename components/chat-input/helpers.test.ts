import type { AttachmentFile } from '@lib/stores/attachment-store';

import { getDifyFileType } from './helpers';

it.each([
  ['source.md', '', 'document'],
  ['source.csv', 'application/octet-stream', 'document'],
  ['photo.png', '', 'image'],
  ['sample.xyz', 'application/octet-stream', 'custom'],
  ['clip.mpeg', 'video/mpeg', 'video'],
  ['sound.mpeg', 'audio/mpeg', 'audio'],
])(
  'uses the same extension classification as the server for %s',
  (name, type, expected) => {
    expect(getDifyFileType({ name, type } as AttachmentFile)).toBe(expected);
  }
);
