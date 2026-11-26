export type ConversationTurns = 'single' | 'multi';

export function readConversationTurns(
  value: unknown
): ConversationTurns | undefined {
  return value === 'single' || value === 'multi' ? value : undefined;
}

export function isSingleConversation(
  turns: unknown,
  defaultSingle = false
): boolean {
  const configured = readConversationTurns(turns);
  return configured === undefined ? defaultSingle : configured === 'single';
}
