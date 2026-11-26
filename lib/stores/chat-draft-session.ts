const prefix = 'agentifui:composer-draft:';

export function composerDraftKey(
  actorId: string,
  sessionId: string | null | undefined,
  kind: string,
  ...parts: (string | null)[]
) {
  return prefix + JSON.stringify([actorId, sessionId ?? null, kind, ...parts]);
}

export function parseDraftScope(scope: string): unknown[] {
  try {
    const parts: unknown = JSON.parse(scope);
    return Array.isArray(parts) ? parts : [];
  } catch {
    return [];
  }
}

export function readComposerDraft(key: string | undefined): unknown {
  if (!key) return;
  try {
    const stored = sessionStorage.getItem(key);
    return stored === null ? undefined : JSON.parse(stored);
  } catch {
    return;
  }
}

export function writeComposerDraft(key: string | undefined, value: unknown) {
  if (!key) return;
  try {
    if (value === undefined) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    return;
  }
}

export function scopedComposerDraftKey(
  kind: string,
  scope: string,
  context: {
    actorId: string | null;
    actorEpoch: number;
    actorSessionId: string | null;
  },
  ...parts: string[]
) {
  const [epoch, actor, app, target] = parseDraftScope(scope);
  if (
    !context.actorId ||
    actor !== context.actorId ||
    epoch !== context.actorEpoch ||
    typeof app !== 'string' ||
    typeof target !== 'string'
  )
    return;
  return composerDraftKey(
    context.actorId,
    context.actorSessionId,
    kind,
    app,
    target,
    ...parts
  );
}

export function taskDraftKey(
  actorId: string,
  sessionId: string | undefined,
  appId: string,
  conversationId: string | null
) {
  return composerDraftKey(actorId, sessionId, 'task', appId, conversationId);
}

export function readTaskDraft(
  key: string
): Record<string, unknown> | undefined {
  const value = readComposerDraft(key);
  if (value && typeof value === 'object' && !Array.isArray(value))
    return value as Record<string, unknown>;
}

export function writeTaskDraft(key: string, inputs: Record<string, unknown>) {
  writeComposerDraft(key, Object.keys(inputs).length ? inputs : undefined);
}

export function moveTaskDraft(from: string, to: string) {
  if (from === to) return;
  try {
    const stored = sessionStorage.getItem(from);
    if (stored !== null) {
      sessionStorage.setItem(to, stored);
      sessionStorage.removeItem(from);
    }
  } catch {
    return;
  }
}

export function clearComposerDrafts() {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) sessionStorage.removeItem(key);
    }
  } catch {
    return;
  }
}
