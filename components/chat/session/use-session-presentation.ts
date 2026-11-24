'use client';

import { type UIEvent, useEffect, useRef, useState } from 'react';

export function useFollowChatOutput({
  scope,
  messages,
  activity,
  streamedText,
  paused,
}: {
  scope: string | null;
  messages: readonly unknown[];
  activity?: readonly unknown[];
  streamedText?: string;
  paused?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const following = useRef({ scope, enabled: true });
  useEffect(() => {
    if (following.current.scope !== scope)
      following.current = { scope, enabled: true };
    if (following.current.enabled && !paused && ref.current)
      ref.current.scrollTop = ref.current.scrollHeight;
  }, [scope, messages, activity, streamedText, paused]);

  return {
    ref,
    onScroll: (event: UIEvent<HTMLDivElement>) => {
      const area = event.currentTarget;
      following.current = {
        scope,
        enabled: area.scrollHeight - area.scrollTop - area.clientHeight < 100,
      };
    },
  };
}

export function useRunProcessSelection(
  scope: string | null,
  hasRun: (id: string) => boolean
) {
  const [selection, setSelection] = useState<{
    scope: string | null;
    id: string;
  } | null>(null);
  const selected =
    selection?.scope === scope && hasRun(selection.id) ? selection.id : null;
  if (selection && selected === null) setSelection(null);
  return {
    selected,
    setOpen: (id: string, open: boolean) =>
      setSelection(previous =>
        open ? { scope, id } : previous?.id === id ? null : previous
      ),
  };
}
