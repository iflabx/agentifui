import { extractMainContentForPreview } from '../../lib/utils';
import {
  analyzeThinkAwareContent,
  parseThinkBlocks,
} from '../../lib/utils/think-parser';

describe('parseThinkBlocks', () => {
  it('should parse plain text', () => {
    const result = parseThinkBlocks('Hello world');
    expect(result).toEqual([{ type: 'text', content: 'Hello world' }]);
  });

  it('should handle empty string input', () => {
    const result = parseThinkBlocks('');
    expect(result).toEqual([]);
  });

  it('should handle whitespace-only input', () => {
    const result = parseThinkBlocks('   ');
    expect(result).toEqual([{ type: 'text', content: '   ' }]);
  });

  it('should parse a simple closed think block', () => {
    const result = parseThinkBlocks('<think>I am thinking</think>');
    expect(result).toEqual([
      { type: 'think', content: 'I am thinking', status: 'closed' },
    ]);
  });

  it('should parse text followed by think block', () => {
    const result = parseThinkBlocks('Hello <think>thinking...</think>');
    expect(result).toEqual([
      { type: 'text', content: 'Hello ' },
      { type: 'think', content: 'thinking...', status: 'closed' },
    ]);
  });

  it('should parse think block followed by text', () => {
    const result = parseThinkBlocks('<think>thinking...</think> World');
    expect(result).toEqual([
      { type: 'think', content: 'thinking...', status: 'closed' },
      { type: 'text', content: ' World' },
    ]);
  });

  it('should parse empty think block', () => {
    const result = parseThinkBlocks('<think></think>');
    expect(result).toEqual([{ type: 'think', content: '', status: 'closed' }]);
  });

  it('should parse interleaved blocks', () => {
    const result = parseThinkBlocks(
      'Start <think>one</think> Middle <think>two</think> End'
    );
    expect(result).toEqual([
      { type: 'text', content: 'Start ' },
      { type: 'think', content: 'one', status: 'closed' },
      { type: 'text', content: ' Middle ' },
      { type: 'think', content: 'two', status: 'closed' },
      { type: 'text', content: ' End' },
    ]);
  });

  it('should handle unclosed think block (optimistic)', () => {
    const result = parseThinkBlocks('<think>I am still thinking');
    expect(result).toEqual([
      { type: 'think', content: 'I am still thinking', status: 'open' },
    ]);
  });

  it('should handle nested think blocks correctly', () => {
    const result = parseThinkBlocks(
      '<think>Outer <think>Inner</think> Back to Outer</think>'
    );
    // The inner tags should be treated as content
    expect(result).toEqual([
      {
        type: 'think',
        content: 'Outer <think>Inner</think> Back to Outer',
        status: 'closed',
      },
    ]);
  });

  it('should handle nested unclosed blocks (optimistic)', () => {
    const result = parseThinkBlocks('<think>Outer <think>Inner');
    expect(result).toEqual([
      { type: 'think', content: 'Outer <think>Inner', status: 'open' },
    ]);
  });

  it('should handle nested unclosed blocks where inner closes but outer does not', () => {
    const result = parseThinkBlocks(
      '<think>Outer <think>Inner</think> Still Outer'
    );
    expect(result).toEqual([
      {
        type: 'think',
        content: 'Outer <think>Inner</think> Still Outer',
        status: 'open',
      },
    ]);
  });

  it('should support details tag as well', () => {
    const result = parseThinkBlocks('<details>Hidden thought</details>');
    expect(result).toEqual([
      { type: 'think', content: 'Hidden thought', status: 'closed' },
    ]);
  });

  it('should ignore mismatched tags inside think block', () => {
    const result = parseThinkBlocks(
      '<think>Start <details>Inside</details> End</think>'
    );
    expect(result).toEqual([
      {
        type: 'think',
        content: 'Start <details>Inside</details> End',
        status: 'closed',
      },
    ]);
  });

  it('should treat orphaned closing tags as text', () => {
    const result = parseThinkBlocks('Hello </think> World');
    expect(result).toEqual([{ type: 'text', content: 'Hello </think> World' }]);
  });

  it('should handle only orphaned closing tag input', () => {
    const result = parseThinkBlocks('</think>');
    expect(result).toEqual([{ type: 'text', content: '</think>' }]);
  });

  it('should handle multiple lines and attributes', () => {
    const result = parseThinkBlocks(
      '<think ignore="true">\nLine 1\nLine 2\n</think>'
    );
    expect(result).toEqual([
      { type: 'think', content: '\nLine 1\nLine 2\n', status: 'closed' },
    ]);
  });

  it('should recover a reply tail from an unclosed think block when a reply marker exists', () => {
    const result = parseThinkBlocks(
      '<think>Plan steps\n\n**生成回复**：\nVisible answer'
    );

    expect(result).toEqual([
      { type: 'think', content: 'Plan steps', status: 'closed' },
      { type: 'text', content: 'Visible answer' },
    ]);
  });

  it('should keep an unclosed think block intact when no safe reply marker exists', () => {
    const analysis = analyzeThinkAwareContent(
      '<think>Plan steps\n\n**生成内容**：\n* bullet'
    );

    expect(analysis.blocks).toEqual([
      {
        type: 'think',
        content: 'Plan steps\n\n**生成内容**：\n* bullet',
        status: 'open',
      },
    ]);
    expect(analysis.mainText).toBe('');
    expect(analysis.hasUnbalancedThink).toBe(true);
    expect(analysis.usedReplyMarkerFallback).toBe(false);
  });

  it('should extract preview text from a repaired malformed think payload', () => {
    const preview = extractMainContentForPreview(
      '<think>Plan steps\n\n**生成回复**：\nVisible answer'
    );

    expect(preview).toBe('Visible answer');
  });

  it('should return an empty preview for malformed think content without a safe answer tail', () => {
    const preview = extractMainContentForPreview(
      '<think>Plan steps\n\n**生成内容**：\n* bullet'
    );

    expect(preview).toBe('');
  });
});
