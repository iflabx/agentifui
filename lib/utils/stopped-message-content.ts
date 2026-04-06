const THINK_BLOCK_PATTERN = /<(?:think|details)(?:\s[^>]*)?>/i;

function readStoppedResponseSnapshot(
  metadata: Record<string, unknown> | null | undefined
): string | null {
  const value = metadata?.stopped_response_text;

  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? value : null;
}

export function resolveStoppedResponseSnapshot(input: {
  text: string;
  metadata?: Record<string, unknown> | null;
}): string | undefined {
  const snapshot = readStoppedResponseSnapshot(input.metadata);
  const currentText = input.text;
  const trimmedCurrentText = currentText.trim();

  if (!trimmedCurrentText) {
    return snapshot ?? undefined;
  }

  if (!snapshot) {
    return currentText;
  }

  const currentHasThink = THINK_BLOCK_PATTERN.test(currentText);
  const snapshotHasThink = THINK_BLOCK_PATTERN.test(snapshot);

  if (currentHasThink && !snapshotHasThink) {
    return currentText;
  }

  return currentText.length >= snapshot.length ? currentText : snapshot;
}

export function resolvePersistedStoppedAssistantText(input: {
  content: string;
  metadata?: Record<string, unknown> | null;
}): string {
  if (input.metadata?.stopped_manually !== true) {
    return input.content;
  }

  const snapshot = readStoppedResponseSnapshot(input.metadata);
  if (!snapshot) {
    return input.content;
  }

  const content = input.content || '';
  const trimmedContent = content.trim();

  if (!trimmedContent) {
    return snapshot;
  }

  const contentHasThink = THINK_BLOCK_PATTERN.test(content);
  const snapshotHasThink = THINK_BLOCK_PATTERN.test(snapshot);

  if (!contentHasThink && snapshotHasThink) {
    return snapshot;
  }

  return snapshot.length > content.length ? snapshot : content;
}
