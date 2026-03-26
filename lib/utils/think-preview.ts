const THINK_PREVIEW_MAX_CHARS = 120;

export function buildThinkPreviewText(content: string): string | undefined {
  const previewText = content
    .replace(/```/g, ' ')
    .replace(/`/g, '')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_~>#]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!previewText) {
    return undefined;
  }

  if (previewText.length <= THINK_PREVIEW_MAX_CHARS) {
    return previewText;
  }

  return `${previewText.slice(0, THINK_PREVIEW_MAX_CHARS).trimEnd()}...`;
}
