import {
  parseAgentDeliverables,
  parseStoredAgentDeliverables,
  publicAgentDeliverables,
} from './agent-result';

const artifact = {
  artifact_id: 'report',
  filename: 'report.md',
  media_type: 'text/markdown',
  size_bytes: 12,
  sha256: 'a'.repeat(64),
};

function ready(overrides: Record<string, unknown> = {}) {
  return {
    profile: 'phase4.result.v1',
    thread_id: 'thread-1',
    run_id: 'run-1',
    execution_status: 'success',
    result_status: 'ready',
    reason: null,
    artifacts: [artifact],
    sources: [
      { source_id: 'source-1', title: 'Fixture', excerpt: 'Synthetic data.' },
    ],
    ...overrides,
  };
}

describe('phase four result manifest', () => {
  it('normalizes a ready manifest for the public result model', () => {
    const manifest = parseAgentDeliverables(ready());
    expect(manifest).toEqual({
      profile: 'phase4.result.v1',
      threadId: 'thread-1',
      runId: 'run-1',
      executionStatus: 'success',
      resultStatus: 'ready',
      reason: null,
      artifacts: [
        {
          artifactId: 'report',
          filename: 'report.md',
          mediaType: 'text/markdown',
          sizeBytes: 12,
          sha256: 'a'.repeat(64),
        },
      ],
      sources: [
        { sourceId: 'source-1', title: 'Fixture', excerpt: 'Synthetic data.' },
      ],
    });
    expect(publicAgentDeliverables(manifest)).toEqual({
      schemaVersion: 1,
      executionStatus: 'success',
      resultStatus: 'ready',
      reason: null,
      artifacts: manifest.artifacts,
      sources: manifest.sources,
    });
    expect(publicAgentDeliverables(manifest)).not.toHaveProperty('threadId');
    expect(publicAgentDeliverables(manifest)).not.toHaveProperty('profile');
    expect(publicAgentDeliverables(manifest)).not.toHaveProperty('runId');
  });

  it.each([
    { execution_status: 'running', result_status: 'ready' },
    { result_status: 'ready', reason: 'not_published', artifacts: [] },
    { result_status: 'pending', reason: null, artifacts: [] },
    {
      result_status: 'ready',
      reason: null,
      artifacts: [{ ...artifact, sha256: 'invalid' }],
    },
  ])('rejects an invalid manifest %#', overrides => {
    expect(() => parseAgentDeliverables(ready(overrides))).toThrow();
  });

  it('round-trips the stored canonical manifest independently of JSONB key order', () => {
    const manifest = parseAgentDeliverables(ready());
    const reordered = Object.fromEntries(Object.entries(manifest).reverse());
    expect(
      parseStoredAgentDeliverables(JSON.parse(JSON.stringify(manifest)))
    ).toEqual(manifest);
    expect(parseStoredAgentDeliverables(reordered)).toEqual(manifest);
    expect(() => parseAgentDeliverables(manifest)).toThrow();
  });

  it.each(['x'.repeat(2048), '\u{1F600}'.repeat(512)])(
    'accepts an excerpt at the 2 KiB UTF-8 limit %#',
    excerpt => {
      const manifest = parseAgentDeliverables(
        ready({
          sources: [{ source_id: 'source-1', title: 'Fixture', excerpt }],
        })
      );
      expect(manifest.sources[0].excerpt).toBe(excerpt);
    }
  );

  it.each(['x'.repeat(2049), '\u4e2d'.repeat(683), '\u{1F600}'.repeat(513)])(
    'rejects an excerpt over the 2 KiB UTF-8 limit %#',
    excerpt => {
      expect(() =>
        parseAgentDeliverables(
          ready({
            sources: [{ source_id: 'source-1', title: 'Fixture', excerpt }],
          })
        )
      ).toThrow();
    }
  );

  it.each([900, 901])(
    'applies the PostgreSQL JSONB text limit to a dense manifest (%i padding bytes)',
    paddingBytes => {
      let remaining = paddingBytes;
      const sources = Array.from({ length: 10 }, (_, index) => {
        const padding = Math.min(remaining, 162);
        remaining -= padding;
        return {
          source_id: `source-${index}`,
          title: '\u4e2d'.repeat(350) + 'x'.repeat(padding),
          excerpt: 'x'.repeat(2048),
        };
      });
      const raw = ready({ sources });
      expect(Buffer.byteLength(JSON.stringify(raw), 'utf8')).toBeLessThan(
        32768
      );
      if (paddingBytes === 900)
        expect(parseAgentDeliverables(raw).sources).toHaveLength(10);
      else
        expect(() => parseAgentDeliverables(raw)).toThrow(
          'result manifest too large'
        );
    }
  );
});
