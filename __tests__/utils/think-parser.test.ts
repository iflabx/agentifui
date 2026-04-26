import { extractMainContentForPreview } from '../../lib/utils';
import {
  analyzeThinkAwareContent,
  materializeIncompleteAssistantReply,
  normalizeCompletedAssistantReply,
  normalizeCompletedThinkAwareContent,
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

  it('should materialize an explicit fallback reply for draft-only think content', () => {
    const result = materializeIncompleteAssistantReply(
      '<think>Plan steps\n\n**生成内容**：\n* bullet',
      '回答未完整生成，请重试。'
    );

    expect(result).toEqual({
      content:
        '<think>Plan steps\n\n**生成内容**：\n* bullet</think>\n\n回答未完整生成，请重试。',
      usedFallback: true,
    });
  });

  it('should recover a visible answer tail from an unclosed think block when it follows a reasoning outline', () => {
    const visibleAnswer =
      '比斯兔建议今晚可以试试二食堂的小火锅，或者一食堂的风味档口。';

    const result = normalizeCompletedAssistantReply(
      `<think>Here is a thinking process:\n\n1. 先分析用户晚饭需求。\n\n2. 再结合校内餐饮选项。\n\n3. 最后给出直接推荐。\n\n${visibleAnswer}`,
      '回答未完整生成，请重试。'
    );

    expect(result).toEqual({
      content: `<think>Here is a thinking process:\n\n1. 先分析用户晚饭需求。\n\n2. 再结合校内餐饮选项。\n\n3. 最后给出直接推荐。</think>\n\n${visibleAnswer}`,
      changed: true,
      usedFallback: false,
    });
  });

  it('should keep normal think-aware content unchanged when a visible reply already exists', () => {
    const result = materializeIncompleteAssistantReply(
      '<think>Plan steps</think>\n\nVisible answer',
      '回答未完整生成，请重试。'
    );

    expect(result).toEqual({
      content: '<think>Plan steps</think>\n\nVisible answer',
      usedFallback: false,
    });
  });

  it('should prune duplicated head and tail think blocks from completed content', () => {
    const result = normalizeCompletedThinkAwareContent(
      '<think>先分析时间请求</think>\n\n<think>先分析时间请求</think>\n\nVisible answer<think>Visible answer</think>'
    );

    expect(result).toEqual({
      content: '<think>先分析时间请求</think>\n\nVisible answer',
      changed: true,
    });
  });

  it('should prune an earlier think block when it is an exact prefix of the following think block', () => {
    const smallerThink =
      '先确认图书馆开放时间，再核对节假日安排，最后补充借阅服务与自习区开放提示，确保给出完整准确的答复。';
    const largerThink = `${smallerThink}用户问的是图书馆“开门了吗”，我还需要核对当前日期时间，再说明资料里只有研讨室预约时间，没有完整的全馆开闭馆表，并提醒用户以当天公告与图书馆联系方式为准。`;

    const result = normalizeCompletedThinkAwareContent(
      `<think>${smallerThink}</think>\n\n<think>${largerThink}</think>\n\nVisible answer`
    );

    expect(result).toEqual({
      content: `<think>${largerThink}</think>\n\nVisible answer`,
      changed: true,
    });
  });

  it('should prune a short earlier think block when it is an exact prefix of the following think block', () => {
    const smallerThink = '先分析时间请求';
    const largerThink = `${smallerThink}，并补充换算步骤`;

    const result = normalizeCompletedThinkAwareContent(
      `<think>${smallerThink}</think>\n\n<think>${largerThink}</think>\n\nVisible answer`
    );

    expect(result).toEqual({
      content: `<think>${largerThink}</think>\n\nVisible answer`,
      changed: true,
    });
  });

  it('should prune a later think block when it is an exact substring of the previous think block', () => {
    const largerThink =
      '用户询问图书馆的开门时间，这是一个关于图书馆开放时间的问题。根据我的知识库分类，这个问题应该优先查询图书馆相关的知识库。User is asking about library opening hours. I queried the library dataset. The returned information contains discussion room booking hours, but not the general library opening hours. I should be careful not to guess and should explain the limitation clearly.';
    const smallerThink =
      'User is asking about library opening hours. I queried the library dataset. The returned information contains discussion room booking hours, but not the general library opening hours. I should be careful not to guess and should explain the limitation clearly.';

    const result = normalizeCompletedThinkAwareContent(
      `<think>${largerThink}</think>\n\n<think>${smallerThink}</think>\n\nVisible answer`
    );

    expect(result).toEqual({
      content: `<think>${largerThink}</think>\n\nVisible answer`,
      changed: true,
    });
  });

  it('should prune a trailing think block when it is an exact subset of the visible answer', () => {
    const answerTail =
      '如果遇到节假日调整，请以当天公告为准，并提前安排借阅和自习时间，同时留意临时闭馆与预约规则变化。';
    const visibleAnswer = `比斯兔竖起大耳朵查了一下，图书馆今天正常开放。${answerTail}`;

    const result = normalizeCompletedThinkAwareContent(
      `${visibleAnswer}<think>${answerTail}</think>`
    );

    expect(result).toEqual({
      content: visibleAnswer,
      changed: true,
    });
  });

  it('should keep short non-prefix subset think blocks to avoid over-pruning', () => {
    const smallerThink = '补充节假日提示';
    const largerThink =
      '先查开门时间再答复，同时补充节假日提示与馆藏服务说明，确保回复完整准确。';

    const result = normalizeCompletedThinkAwareContent(
      `<think>${smallerThink}</think>\n\n<think>${largerThink}</think>\n\nVisible answer`
    );

    expect(result).toEqual({
      content: `<think>${smallerThink}</think>\n\n<think>${largerThink}</think>\n\nVisible answer`,
      changed: false,
    });
  });

  it('should keep similar think blocks when they are not exact contained substrings', () => {
    const firstThink =
      '先确认今天是否开馆，再查看自习区安排，最后提醒用户关注官网公告，确保信息可靠完整。';
    const secondThink =
      '先确认今日开馆状态，并核对自习区开放安排，最后提醒用户以官网公告为准，确保答复可靠。';

    const result = normalizeCompletedThinkAwareContent(
      `<think>${firstThink}</think>\n\n<think>${secondThink}</think>\n\nVisible answer`
    );

    expect(result).toEqual({
      content: `<think>${firstThink}</think>\n\n<think>${secondThink}</think>\n\nVisible answer`,
      changed: false,
    });
  });

  it('should combine duplicate-think normalization with the draft-only fallback flow', () => {
    const result = normalizeCompletedAssistantReply(
      '<think>Plan steps\n\n**生成内容**：\n* bullet',
      '回答未完整生成，请重试。'
    );

    expect(result).toEqual({
      content:
        '<think>Plan steps\n\n**生成内容**：\n* bullet</think>\n\n回答未完整生成，请重试。',
      changed: true,
      usedFallback: true,
    });
  });

  it('should combine subset-think normalization with the draft-only fallback flow', () => {
    const smallerThink =
      '先确认图书馆开放时间，再核对节假日安排，最后补充借阅服务与自习区开放提示，确保给出完整准确的答复。';
    const largerThink = `${smallerThink}如果官网没有写明临时调整，还需要提醒用户以当天公告为准。`;

    const result = normalizeCompletedAssistantReply(
      `<think>${smallerThink}</think>\n\n<think>${largerThink}</think>`,
      '回答未完整生成，请重试。'
    );

    expect(result).toEqual({
      content: `<think>${largerThink}</think>\n\n回答未完整生成，请重试。`,
      changed: true,
      usedFallback: true,
    });
  });

  it('should keep draft-only content unchanged when the fallback text is empty', () => {
    const result = materializeIncompleteAssistantReply(
      '<think>Plan steps\n\n**生成内容**：\n* bullet',
      '   '
    );

    expect(result).toEqual({
      content: '<think>Plan steps\n\n**生成内容**：\n* bullet',
      usedFallback: false,
    });
  });
});
