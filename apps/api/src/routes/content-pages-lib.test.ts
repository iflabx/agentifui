/** @jest-environment node */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  ContentPageStructureConflictError,
  getMergedPageContent,
  readLocaleFile,
  readStructureFile,
  savePageLocale,
  savePageStructure,
} from './content-pages-lib';

async function writeJson(filePath: string, value: unknown) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

async function seedAboutPage(root: string) {
  const aboutDir = path.join(root, 'content/pages/about');
  const localesDir = path.join(aboutDir, 'locales');
  await Promise.all([
    mkdir(aboutDir, { recursive: true }),
    mkdir(localesDir, { recursive: true }),
  ]);

  await writeJson(path.join(aboutDir, 'structure.json'), {
    page: 'about',
    sourceLocale: 'en-US',
    metadata: {
      version: '1.0.0',
      author: 'seed',
      lastModified: '2026-03-29T00:00:00.000Z',
      structureVersion: 3,
    },
    sections: [
      {
        id: 'section-hero',
        layout: 'single-column',
        columns: [
          [
            {
              id: 'comp-heading',
              type: 'heading',
              props: {
                level: 1,
                textAlign: 'center',
              },
            },
          ],
        ],
      },
    ],
  });

  await writeJson(path.join(localesDir, 'en-US.json'), {
    page: 'about',
    locale: 'en-US',
    metadata: {
      locale: 'en-US',
      author: 'seed',
      lastModified: '2026-03-29T00:00:00.000Z',
      basedOnStructureVersion: 3,
    },
    sections: [
      {
        id: 'section-hero',
        columns: [
          [
            {
              id: 'comp-heading',
              type: 'heading',
              props: {
                content: 'Old English Heading',
              },
            },
          ],
        ],
      },
    ],
  });

  await writeJson(path.join(localesDir, 'zh-CN.json'), {
    page: 'about',
    locale: 'zh-CN',
    metadata: {
      locale: 'zh-CN',
      author: 'seed',
      lastModified: '2026-03-29T00:00:00.000Z',
      basedOnStructureVersion: 3,
    },
    sections: [
      {
        id: 'section-hero',
        columns: [
          [
            {
              id: 'comp-heading',
              type: 'heading',
              props: {
                content: '旧中文标题',
              },
            },
          ],
        ],
      },
    ],
  });
}

describe('content page persistence helpers', () => {
  const originalCwd = process.cwd();
  let tempRoot = '';

  beforeEach(async () => {
    tempRoot = await mkdtemp(
      path.join(os.tmpdir(), 'agentifui-content-pages-')
    );
    await seedAboutPage(tempRoot);
    process.chdir(tempRoot);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('increments structure version and only rewrites en-US when saving structure', async () => {
    const result = await savePageStructure({
      page: 'about',
      expectedStructureVersion: 3,
      mergedPageContent: {
        sections: [
          {
            id: 'section-hero',
            layout: 'single-column',
            columns: [
              [
                {
                  id: 'comp-heading',
                  type: 'heading',
                  props: {
                    content: 'New English Heading',
                    level: 1,
                    textAlign: 'center',
                  },
                },
              ],
            ],
          },
        ],
        metadata: {
          author: 'admin-user',
        },
      },
    });

    expect(result.structureVersion).toBe(4);

    const structureFile = await readStructureFile('about');
    expect(structureFile.metadata?.structureVersion).toBe(4);

    const enLocale = await readLocaleFile('about', 'en-US');
    expect(enLocale?.metadata?.basedOnStructureVersion).toBe(4);
    expect(enLocale?.sections[0].columns[0][0].props).toEqual({
      content: 'New English Heading',
    });

    const zhLocale = await readLocaleFile('about', 'zh-CN');
    expect(zhLocale?.metadata?.basedOnStructureVersion).toBe(3);
    expect(zhLocale?.sections[0].columns[0][0].props).toEqual({
      content: '旧中文标题',
    });
  });

  it('saves only the requested locale when structure version matches', async () => {
    const result = await savePageLocale({
      page: 'about',
      locale: 'zh-CN',
      basedOnStructureVersion: 3,
      mergedPageContent: {
        sections: [
          {
            id: 'section-hero',
            layout: 'single-column',
            columns: [
              [
                {
                  id: 'comp-heading',
                  type: 'heading',
                  props: {
                    content: '新的中文标题',
                    level: 1,
                    textAlign: 'center',
                  },
                },
              ],
            ],
          },
        ],
        metadata: {
          author: 'translator',
        },
      },
    });

    expect(result.structureVersion).toBe(3);

    const structureFile = await readStructureFile('about');
    expect(structureFile.metadata?.structureVersion).toBe(3);

    const zhLocale = await readLocaleFile('about', 'zh-CN');
    expect(zhLocale?.metadata?.basedOnStructureVersion).toBe(3);
    expect(zhLocale?.sections[0].columns[0][0].props).toEqual({
      content: '新的中文标题',
    });

    const enLocale = await readLocaleFile('about', 'en-US');
    expect(enLocale?.sections[0].columns[0][0].props).toEqual({
      content: 'Old English Heading',
    });

    const merged = await getMergedPageContent('about', 'zh-CN');
    expect(merged.metadata?.structureVersion).toBe(3);
    expect(merged.metadata?.basedOnStructureVersion).toBe(3);
  });

  it('rejects locale saves when the editor is based on an older structure version', async () => {
    await expect(
      savePageLocale({
        page: 'about',
        locale: 'zh-CN',
        basedOnStructureVersion: 2,
        mergedPageContent: {
          sections: [],
        },
      })
    ).rejects.toBeInstanceOf(ContentPageStructureConflictError);
  });
});
