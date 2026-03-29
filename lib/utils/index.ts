import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import { parseThinkBlocks } from './think-parser';

/**
 * Utility function to merge className values.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format bytes as a human-readable file size string.
 * @param bytes - The number of bytes.
 * @param decimals - Number of decimal places to display.
 * @returns Formatted file size string.
 */
export function formatBytes(bytes: number, decimals: number = 2): string {
  if (bytes === 0) return '0 Bytes';

  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Extracts the main content from an assistant message, removing reasoning text
 * (think and details tags). The logic is kept fully consistent with the frontend's
 * extractMainContentForCopy. Used to generate conversation previews by filtering
 * out reasoning and only showing the actual answer content.
 * @param rawContent - The raw message content.
 * @returns The cleaned main content string.
 */
export function extractMainContentForPreview(rawContent: string): string {
  // Check for unclosed key tags
  const openThinkCount = (rawContent.match(/<think(?:\s[^>]*)?>/gi) || [])
    .length;
  const closeThinkCount = (rawContent.match(/<\/think>/gi) || []).length;
  const openDetailsCount = (rawContent.match(/<details(?:\s[^>]*)?>/gi) || [])
    .length;
  const closeDetailsCount = (rawContent.match(/<\/details>/gi) || []).length;

  // If there are unclosed tags, the content is still being generated, return empty string
  if (
    openThinkCount > closeThinkCount ||
    openDetailsCount > closeDetailsCount
  ) {
    return '';
  }

  let cleanContent = rawContent;

  // Remove all <think>...</think> blocks
  const thinkRegex = /<think(?:\s[^>]*)?>[\s\S]*?<\/think>/gi;
  cleanContent = cleanContent.replace(thinkRegex, '');

  // Remove all <details>...</details> blocks
  const detailsRegex = /<details(?:\s[^>]*)?>[\s\S]*?<\/details>/gi;
  cleanContent = cleanContent.replace(detailsRegex, '');

  // Clean up extra whitespace
  return cleanContent.replace(/\n\s*\n/g, '\n').trim();
}

export function hasThinkAwareContent(rawContent: string): boolean {
  return /<(think|details)(?:\s[^>]*)?>/i.test(rawContent);
}

export function extractMainTextFromThinkAwareContent(
  rawContent: string
): string {
  const extracted = extractMainContentForPreview(rawContent);
  if (extracted) {
    return extracted;
  }

  return parseThinkBlocks(rawContent)
    .filter(block => block.type === 'text')
    .map(block => block.content)
    .join('')
    .replace(/\n\s*\n/g, '\n')
    .trim();
}
