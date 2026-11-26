import {
  readComposerDraft,
  scopedComposerDraftKey,
  writeComposerDraft,
} from '@lib/stores/chat-draft-session';
import { useChatInputStore } from '@lib/stores/chat-input-store';

import { useMemo, useState } from 'react';

type Value = string | number;
const empty: Record<string, Value> = {};

export function useComposerParameterDraft(
  kind: 'agent-parameters' | 'chatflow-parameters',
  scope: string | null
) {
  const key = useChatInputStore(state =>
    scope ? scopedComposerDraftKey(kind, scope, state) : undefined
  );
  const stored = useMemo(() => {
    const draft = readComposerDraft(key);
    if (!draft || typeof draft !== 'object' || Array.isArray(draft))
      return empty;
    return Object.fromEntries(
      Object.entries(draft).filter(
        ([, value]) => typeof value === 'string' || typeof value === 'number'
      )
    ) as Record<string, Value>;
  }, [key]);
  const [current, setCurrent] = useState<{
    scope: string;
    values: Record<string, Value>;
  }>();
  const values = current && current.scope === scope ? current.values : stored;
  return {
    values,
    setValue: (field: string, value: unknown) => {
      if (!scope || (typeof value !== 'string' && typeof value !== 'number'))
        return;
      const updated = { ...values, [field]: value };
      writeComposerDraft(key, updated);
      setCurrent({ scope, values: updated });
    },
    clear: () => {
      writeComposerDraft(key, undefined);
      if (scope)
        setCurrent(previous =>
          !previous || previous.scope === scope
            ? { scope, values: empty }
            : previous
        );
    },
  };
}
