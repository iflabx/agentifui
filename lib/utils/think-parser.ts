export type ThinkBlockStatus = 'open' | 'closed';

export interface MessageBlock {
  type: 'text' | 'think';
  content: string;
  status?: ThinkBlockStatus; // Only for 'think' type
}

type ThinkTagType = 'think' | 'details';
type ParsedThinkBlock = MessageBlock & {
  type: 'think';
  status: ThinkBlockStatus;
};

export interface ThinkAwareAnalysis {
  blocks: MessageBlock[];
  mainText: string;
  hasUnbalancedThink: boolean;
  usedReplyMarkerFallback: boolean;
}

const REPLY_MARKERS = [
  '**生成回复**：',
  '**生成回复**:',
  '生成回复：',
  '生成回复:',
  '**最终回复**：',
  '**最终回复**:',
  '最终回复：',
  '最终回复:',
];

function normalizeMainText(content: string): string {
  return content.replace(/\n\s*\n/g, '\n').trim();
}

function normalizeComparableText(content: string): string {
  return content.replace(/\s+/g, ' ').trim();
}

function countTag(content: string, tag: 'think' | 'details', close = false) {
  if (close) {
    return (content.match(new RegExp(`</${tag}>`, 'gi')) || []).length;
  }

  return (content.match(new RegExp(`<${tag}(?:\\s[^>]*)?>`, 'gi')) || [])
    .length;
}

function isLikelyReplyText(content: string): boolean {
  const trimmed = content.trim();

  if (!trimmed) {
    return false;
  }

  if (/^(?:[-*+]\s|\d+[.)]\s)/.test(trimmed)) {
    return false;
  }

  return true;
}

function extractReplyFromOpenThink(content: string): {
  thinkContent: string;
  answerText: string;
} | null {
  let markerIndex = -1;
  let markerLength = 0;

  for (const marker of REPLY_MARKERS) {
    const index = content.lastIndexOf(marker);
    if (index > markerIndex) {
      markerIndex = index;
      markerLength = marker.length;
    }
  }

  if (markerIndex < 0) {
    return null;
  }

  const answerText = content.slice(markerIndex + markerLength).trim();
  if (!isLikelyReplyText(answerText)) {
    return null;
  }

  return {
    thinkContent: content.slice(0, markerIndex).trimEnd(),
    answerText,
  };
}

function finalizeBlocks(blocks: MessageBlock[]): MessageBlock[] {
  return blocks.reduce((acc, block) => {
    if (block.content.length === 0 && block.type === 'text') {
      return acc;
    }

    if (block.type === 'text' && acc[acc.length - 1]?.type === 'text') {
      acc[acc.length - 1].content += block.content;
    } else {
      acc.push(block);
    }

    return acc;
  }, [] as MessageBlock[]);
}

function isWhitespaceOnlyTextBlock(block: MessageBlock | undefined): boolean {
  return block?.type === 'text' && block.content.trim().length === 0;
}

function findLastMeaningfulBlockIndex(blocks: MessageBlock[]): number {
  let index = blocks.length - 1;

  while (index >= 0 && isWhitespaceOnlyTextBlock(blocks[index])) {
    index -= 1;
  }

  return index;
}

function pruneRedundantThinkBlocks(blocks: MessageBlock[]): {
  blocks: MessageBlock[];
  changed: boolean;
} {
  const pruned: MessageBlock[] = [];
  let changed = false;

  for (const block of blocks) {
    if (block.type !== 'think') {
      pruned.push(block);
      continue;
    }

    const comparableContent = normalizeComparableText(block.content);
    const previousMeaningfulIndex = findLastMeaningfulBlockIndex(pruned);
    const previousMeaningfulBlock =
      previousMeaningfulIndex >= 0 ? pruned[previousMeaningfulIndex] : null;

    if (
      comparableContent &&
      previousMeaningfulBlock?.type === 'think' &&
      normalizeComparableText(previousMeaningfulBlock.content) ===
        comparableContent
    ) {
      if (isWhitespaceOnlyTextBlock(pruned[pruned.length - 1])) {
        pruned.pop();
      }
      changed = true;
      continue;
    }

    pruned.push(block);
  }

  const mainText = normalizeMainText(
    pruned
      .filter(block => block.type === 'text')
      .map(block => block.content)
      .join('')
  );
  const comparableMainText = normalizeComparableText(mainText);
  const lastMeaningfulIndex = findLastMeaningfulBlockIndex(pruned);
  const lastMeaningfulBlock =
    lastMeaningfulIndex >= 0 ? pruned[lastMeaningfulIndex] : null;

  if (
    comparableMainText &&
    lastMeaningfulBlock?.type === 'think' &&
    normalizeComparableText(lastMeaningfulBlock.content) === comparableMainText
  ) {
    pruned.splice(lastMeaningfulIndex, 1);
    changed = true;
  }

  return {
    blocks: finalizeBlocks(pruned),
    changed,
  };
}

function parseThinkBlocksRaw(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = [];
  const tagRegex = /<\/?(think|details)(?:\s[^>]*)?>/gi;

  let lastIndex = 0;
  let depth = 0;
  let activeTagType: ThinkTagType | null = null; // 'think' or 'details'
  let blockStartIndex = 0; // Where the current Think block content started

  let match;
  while ((match = tagRegex.exec(content)) !== null) {
    const tagFull = match[0];
    const tagName = match[1].toLowerCase() as ThinkTagType;
    const isCloseTag = tagFull.startsWith('</');
    const matchIndex = match.index;

    if (activeTagType === null) {
      if (!isCloseTag) {
        if (matchIndex > lastIndex) {
          const textContent = content.slice(lastIndex, matchIndex);
          blocks.push({ type: 'text', content: textContent });
        }

        activeTagType = tagName;
        depth = 1;
        blockStartIndex = tagRegex.lastIndex;
      }
    } else if (tagName === activeTagType) {
      if (!isCloseTag) {
        depth++;
      } else {
        depth--;
      }

      if (depth === 0) {
        const thinkContent = content.slice(blockStartIndex, matchIndex);
        blocks.push({
          type: 'think',
          content: thinkContent,
          status: 'closed',
        });

        activeTagType = null;
        lastIndex = tagRegex.lastIndex;
      }
    }
  }

  if (activeTagType !== null) {
    const thinkContent = content.slice(blockStartIndex);
    blocks.push({ type: 'think', content: thinkContent, status: 'open' });
  } else if (lastIndex < content.length) {
    const textContent = content.slice(lastIndex);
    blocks.push({ type: 'text', content: textContent });
  }

  return finalizeBlocks(blocks);
}

export function analyzeThinkAwareContent(content: string): ThinkAwareAnalysis {
  const rawBlocks = parseThinkBlocksRaw(content);
  const openThinkCount = countTag(content, 'think');
  const closeThinkCount = countTag(content, 'think', true);
  const openDetailsCount = countTag(content, 'details');
  const closeDetailsCount = countTag(content, 'details', true);
  const hasUnbalancedThink =
    openThinkCount > closeThinkCount || openDetailsCount > closeDetailsCount;

  let usedReplyMarkerFallback = false;
  const blocks = [...rawBlocks];
  const lastBlock = blocks[blocks.length - 1];

  if (
    hasUnbalancedThink &&
    lastBlock?.type === 'think' &&
    lastBlock.status === 'open'
  ) {
    const replySplit = extractReplyFromOpenThink(lastBlock.content);

    if (replySplit) {
      usedReplyMarkerFallback = true;
      blocks.splice(
        blocks.length - 1,
        1,
        {
          type: 'think',
          content: replySplit.thinkContent,
          status: 'closed',
        } satisfies ParsedThinkBlock,
        {
          type: 'text',
          content: replySplit.answerText,
        }
      );
    }
  }

  const finalizedBlocks = finalizeBlocks(blocks);
  const mainText = normalizeMainText(
    finalizedBlocks
      .filter(block => block.type === 'text')
      .map(block => block.content)
      .join('')
  );

  return {
    blocks: finalizedBlocks,
    mainText,
    hasUnbalancedThink,
    usedReplyMarkerFallback,
  };
}

function serializeThinkAwareBlocks(blocks: MessageBlock[]): string {
  return blocks
    .map(block =>
      block.type === 'think' ? `<think>${block.content}</think>` : block.content
    )
    .join('');
}

export function normalizeCompletedThinkAwareContent(content: string): {
  content: string;
  changed: boolean;
} {
  if (!content.trim()) {
    return {
      content,
      changed: false,
    };
  }

  const analysis = analyzeThinkAwareContent(content);
  const pruned = pruneRedundantThinkBlocks(analysis.blocks);

  if (!pruned.changed) {
    return {
      content,
      changed: false,
    };
  }

  return {
    content: serializeThinkAwareBlocks(pruned.blocks).trimEnd(),
    changed: true,
  };
}

export function normalizeCompletedAssistantReply(
  content: string,
  fallbackText: string
): {
  content: string;
  changed: boolean;
  usedFallback: boolean;
} {
  const normalized = normalizeCompletedThinkAwareContent(content);
  const materialized = materializeIncompleteAssistantReply(
    normalized.content,
    fallbackText
  );

  return {
    content: materialized.content,
    changed: normalized.changed || materialized.content !== content,
    usedFallback: materialized.usedFallback,
  };
}

export function materializeIncompleteAssistantReply(
  content: string,
  fallbackText: string
): {
  content: string;
  usedFallback: boolean;
} {
  const trimmedFallback = fallbackText.trim();
  if (!content.trim() || !trimmedFallback) {
    return {
      content,
      usedFallback: false,
    };
  }

  const analysis = analyzeThinkAwareContent(content);
  const hasThinkBlock = analysis.blocks.some(block => block.type === 'think');

  if (analysis.mainText || !hasThinkBlock) {
    return {
      content,
      usedFallback: false,
    };
  }

  const normalizedThinkContent = serializeThinkAwareBlocks(
    analysis.blocks
  ).trimEnd();

  return {
    content: `${normalizedThinkContent}\n\n${trimmedFallback}`,
    usedFallback: true,
  };
}

/**
 * Parses a message string into a sequence of think blocks and text blocks.
 * Supports:
 * - Multiple interleaved think and text blocks
 * - Nested think tags (treats outer tags as boundaries)
 * - Unclosed think tags (optimistic handling)
 * - <details> tags (as legacy/alternative think blocks)
 *
 * @param content The raw message content
 * @returns Array of MessageBlocks
 */
export function parseThinkBlocks(content: string): MessageBlock[] {
  return analyzeThinkAwareContent(content).blocks;
}
