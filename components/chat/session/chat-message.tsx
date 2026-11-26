import type { ComponentProps } from 'react';

import { AssistantMessage, UserMessage } from '../messages';

type ChatMessageProps =
  | ({ role: 'user' } & ComponentProps<typeof UserMessage>)
  | ({ role: 'assistant' } & ComponentProps<typeof AssistantMessage>);

export function ChatMessage(props: ChatMessageProps) {
  if (props.role === 'user') return <UserMessage {...props} />;
  return <AssistantMessage {...props} />;
}
