/** @jest-environment node */
import { determineTextGenerationFinalStatus } from '@lib/hooks/use-text-generation-execution/persistence';
import {
  calculateTextGenerationProgress,
  countGeneratedWords,
} from '@lib/hooks/use-text-generation-execution/stream-helpers';

describe('text generation execution helpers', () => {
  it('prefers completed when generated text exists', () => {
    expect(
      determineTextGenerationFinalStatus(
        { error: 'upstream failed' },
        'hello world',
        null
      )
    ).toBe('completed');
  });

  it('falls back to failed when only error exists', () => {
    expect(
      determineTextGenerationFinalStatus({ error: 'upstream failed' }, '', null)
    ).toBe('failed');
  });

  it('uses message id when no text and no error exist', () => {
    expect(determineTextGenerationFinalStatus({}, '', 'msg-1')).toBe(
      'completed'
    );
    expect(determineTextGenerationFinalStatus({}, '', null)).toBe('failed');
  });

  it('caps text generation progress at 90', () => {
    expect(calculateTextGenerationProgress('a'.repeat(100))).toBe(10);
    expect(calculateTextGenerationProgress('a'.repeat(2000))).toBe(90);
  });

  it('counts generated words by whitespace groups', () => {
    expect(countGeneratedWords('hello   world\nnext line')).toBe(4);
    expect(countGeneratedWords('   ')).toBe(0);
  });
});
