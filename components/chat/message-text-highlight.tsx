import type rehypeKatex from 'rehype-katex';

const highlightClass =
  'rounded-sm bg-amber-100 text-stone-900 dark:bg-amber-900 dark:text-amber-50';

function splitMatch(text: string, query?: string) {
  if (!query) return null;
  const literal = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(literal, 'iu').exec(text);
  if (!match) return null;
  return {
    before: text.slice(0, match.index),
    matched: match[0],
    after: text.slice(match.index + match[0].length),
  };
}

export function highlightMessageText(text: string, query?: string) {
  const match = splitMatch(text, query);
  if (!match) return text;
  return (
    <>
      {match.before}
      <mark className={highlightClass}>{match.matched}</mark>
      {match.after}
    </>
  );
}

type MarkdownTree = Parameters<ReturnType<typeof rehypeKatex>>[0];
type MarkdownParent =
  MarkdownTree | Extract<MarkdownTree['children'][number], { type: 'element' }>;

export function rehypeHighlightMessage(query: string) {
  return (tree: MarkdownTree) => {
    function highlight(parent: MarkdownParent): boolean {
      for (const [index, child] of parent.children.entries()) {
        if (child.type === 'element') {
          const classes = child.properties.className;
          if (
            child.tagName === 'pre' ||
            (Array.isArray(classes) && classes.includes('katex'))
          )
            continue;
          if (highlight(child)) return true;
        }
        if (child.type !== 'text') continue;
        const match = splitMatch(child.value, query);
        if (!match) continue;
        parent.children.splice(
          index,
          1,
          { type: 'text', value: match.before },
          {
            type: 'element',
            tagName: 'mark',
            properties: { className: highlightClass.split(' ') },
            children: [{ type: 'text', value: match.matched }],
          },
          { type: 'text', value: match.after }
        );
        return true;
      }
      return false;
    }
    highlight(tree);
  };
}
