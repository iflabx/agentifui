export interface ThinkTag {
  index: number;
  end: number;
  name: 'think' | 'details';
  closing: boolean;
}

export function scanThinkMarkup(
  content: string,
  streaming = false
): {
  tags: ThinkTag[];
  pendingTagIndex: number | null;
  codeRanges: { start: number; end: number }[];
  codeClosure: string;
} {
  const tags: ThinkTag[] = [];
  const codeRanges: { start: number; end: number }[] = [];
  let fence: { marker: string; length: number } | null = null;
  let inlineTicks = 0;
  let codeStart = 0;
  let cursor = 0;

  while (cursor < content.length) {
    if (cursor === 0 || content[cursor - 1] === '\n') {
      const lineEnd = content.indexOf('\n', cursor);
      const line = content.slice(cursor, lineEnd < 0 ? undefined : lineEnd);
      const delimiter = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);

      if (fence) {
        if (
          delimiter &&
          delimiter[1][0] === fence.marker &&
          delimiter[1].length >= fence.length &&
          delimiter[2].trim() === ''
        ) {
          fence = null;
          codeRanges.push({
            start: codeStart,
            end: lineEnd < 0 ? content.length : lineEnd + 1,
          });
        }
        cursor = lineEnd < 0 ? content.length : lineEnd + 1;
        continue;
      }

      if (
        !inlineTicks &&
        delimiter &&
        (delimiter[1][0] !== '`' || !delimiter[2].includes('`'))
      ) {
        fence = { marker: delimiter[1][0], length: delimiter[1].length };
        codeStart = cursor;
        cursor = lineEnd < 0 ? content.length : lineEnd + 1;
        continue;
      }
    }

    if (content[cursor] === '\\' && !inlineTicks) {
      cursor += 2;
      continue;
    }

    if (content[cursor] === '`') {
      let end = cursor + 1;
      while (content[end] === '`') end += 1;
      const length = end - cursor;
      if (!inlineTicks) {
        let closing = content.indexOf('`', end);
        while (closing >= 0) {
          let closingEnd = closing + 1;
          while (content[closingEnd] === '`') closingEnd += 1;
          if (closingEnd - closing === length) break;
          closing = content.indexOf('`', closingEnd);
        }
        if (closing < 0 && !streaming) {
          cursor = end;
          continue;
        }
        inlineTicks = length;
        codeStart = cursor;
      } else if (inlineTicks === length) {
        inlineTicks = 0;
        codeRanges.push({ start: codeStart, end });
      }
      cursor = end;
      continue;
    }

    if (!inlineTicks && content[cursor] === '<') {
      const tail = content.slice(cursor);
      const match = tail.match(/^<(\/?)(think|details)(?:\s[^>]*)?>/i);
      if (match) {
        tags.push({
          index: cursor,
          end: cursor + match[0].length,
          name: match[2].toLowerCase() as ThinkTag['name'],
          closing: match[1] === '/',
        });
        cursor += match[0].length;
        continue;
      }
      const lower = tail.toLowerCase();
      if (
        !tail.includes('>') &&
        ['<think', '</think', '<details', '</details'].some(
          tag => tag.startsWith(lower) || new RegExp(`^${tag}\\s`).test(lower)
        )
      ) {
        return { tags, pendingTagIndex: cursor, codeRanges, codeClosure: '' };
      }
    }
    cursor += 1;
  }

  if (fence || inlineTicks)
    codeRanges.push({ start: codeStart, end: content.length });
  const codeClosure = fence
    ? `\n${fence.marker.repeat(fence.length)}\n`
    : '`'.repeat(inlineTicks);
  return { tags, pendingTagIndex: null, codeRanges, codeClosure };
}

export function mapOutsideMarkdownCode(
  content: string,
  transform: (text: string) => string,
  streaming = false
): string {
  const { codeRanges } = scanThinkMarkup(content, streaming);
  let cursor = 0;
  let output = '';
  for (const range of codeRanges) {
    output += transform(content.slice(cursor, range.start));
    output += content.slice(range.start, range.end);
    cursor = range.end;
  }
  return output + transform(content.slice(cursor));
}
