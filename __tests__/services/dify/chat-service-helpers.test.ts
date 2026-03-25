/** @jest-environment node */
import {
  extractRetrieverResources,
  extractUsage,
} from '@lib/services/dify/chat-service/helpers';

describe('dify chat service helpers', () => {
  it('extracts usage only when total_tokens is numeric', () => {
    expect(extractUsage({ total_tokens: 12, prompt_tokens: 3 })).toEqual(
      expect.objectContaining({ total_tokens: 12 })
    );
    expect(extractUsage({ total_tokens: '12' })).toBeUndefined();
    expect(extractUsage(null)).toBeUndefined();
  });

  it('prefers valid preferred retriever resources and falls back otherwise', () => {
    const valid = [
      {
        segment_id: 'seg-1',
        document_id: 'doc-1',
        document_name: 'Doc',
        position: 1,
        content: 'hello',
      },
    ];
    const fallback = [
      {
        segment_id: 'seg-2',
        document_id: 'doc-2',
        document_name: 'Fallback',
        position: 2,
        content: 'world',
      },
    ];

    expect(extractRetrieverResources(valid, fallback)).toEqual(valid);
    expect(extractRetrieverResources([{ bad: true }], fallback)).toEqual(
      fallback
    );
  });
});
