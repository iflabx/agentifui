const THINK_PREVIEW_MAX_CHARS = 120;
const THINK_PREVIEW_ELLIPSIS = '...';

function normalizeThinkPreviewText(content: string): string {
  return content
    .replace(/```/g, ' ')
    .replace(/`/g, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~>#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildThinkPreviewText(content: string): string | undefined {
  const previewText = normalizeThinkPreviewText(content);

  if (!previewText) {
    return undefined;
  }

  if (previewText.length <= THINK_PREVIEW_MAX_CHARS) {
    return previewText;
  }

  const previewTailLength =
    THINK_PREVIEW_MAX_CHARS - THINK_PREVIEW_ELLIPSIS.length;

  return `${THINK_PREVIEW_ELLIPSIS}${previewText
    .slice(-previewTailLength)
    .trimStart()}`;
}
