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
