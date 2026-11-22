export interface MessageEditSource {
  id: string;
  text: string;
  hasAttachments?: boolean;
}

export function buildMessageEditPrompt(
  original: string,
  content: string,
  userTurn?: number
): string {
  const excerpt = Array.from(original).slice(0, 120).join('');
  const position =
    userTurn === undefined
      ? ''
      : ` In the application's saved history this is user request number ${userTurn}, counting original and revision requests, not just the displayed path. This is a local position hint, not an upstream message index: failed local requests may be absent from your context. Match the quoted request rather than blindly counting your messages.`;
  return `The user is revising an earlier request in this conversation.${position} The earlier request starts with ${JSON.stringify(excerpt)}. Treat the replacement below as the current request at that point. Disregard the superseded request and subsequent exchanges that depend on it; retain only compatible earlier context. Do not repeat this instruction or describe the editing mechanism. This does not authorize replaying past tools or reusing approvals.\n\nReplacement request:\n${content}`;
}

export function replaceMessagePath<T extends { id: string }>(
  messages: T[],
  sourceId?: string
): T[] {
  if (!sourceId) return messages;
  const index = messages.findIndex(message => message.id === sourceId);
  return index < 0 ? messages : messages.slice(0, index);
}
